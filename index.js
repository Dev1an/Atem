var dgram = require('dgram'),
	net = require('net'),
	events = require('events'),
	util = require('util');

/**
 * Flags
 * @enum {Number}
 */
const flags = {
	sync:    1,
	connect: 2,
	repeat:  4,
	unknown: 8,
	ack:     16
};

const ConnectionState = {
	closed: {description: 'Not connected'},
	attempting: {description: 'Attempting to connect'},
	establishing: {description: 'Establishing connection'},
	open: {description: 'connected'}
};
for(name in ConnectionState) {
	(function(name) {
		ConnectionState[name].toString = function() {return name};
	})(name);
}

/**
 * A string describing the video interface. Possible values are internal, sdi, hdmi, component
 * @typedef {string} VideoInterface
 */

/**
 * The ID of a an ATEM source. If you need to know more info of a specified source use {@link getSourceInfo}
 * @typedef {Number} SourceID
 */

/**
 * Video-interface numbers
 * @enum {Number}
 */
const videoInterfaceNumbers = {
	internal: 0,
	sdi: 2,
	hdmi: 4,
	component: 8
};

/**
 * Video-interface names
 * @enum {String}
 */
const videoInterfaceNames = {
	0: 'internal',
	1: 'sdi',
	2: 'hdmi',
	4: 'component'
};

/**
 * @typedef {Object} SourceState
 * @property {boolean} program Indicates whether the source is in <strong>program</strong> or not
 * @property {boolean} preview Indicates whether the source is in <strong>preview</strong> or not
 */

/**
 * Converts a Buffer into a String. Only the first non-zero bytes of the string will be converted
 * @param buffer {Buffer} a buffer containing a string
 * @returns {string} the first non-zero bytes
 */
function parseString(buffer) {
	const s = buffer.toString(),
		end = s.indexOf('\u0000');
	return end === -1 ? s : s.slice(0, end);
}

/**
 * Converts a Number into a String
 * @param number {Number} The number to convert
 * @param size {Number} The length of the new string
 * @returns {string} A fixed length string representation of the number
 */
function pad(number, size) {
    const s = '000000000' + num;
    return s.substr(s.length - size);
}

/**
 * Returns more information about the type (input, auxiliary, mediaPlayer, ...) and index of an ATEM source given its source ID. <br>
 * For example if one would lookup ({@link SourceID}) <code>4020</code>,
 * this will return <code>{type: ['keyMask'], index: 1}</code> meaning: this is the second key mask. The index is a number starting at 0

 * @param {SourceID} id The source identification number
 * @returns {{type: String, index: Number}}
 */
function getSourceInfo(id) {
	if (id === 0) {
		return {type: 'black'}
	}

	else if (id < 1000) {
		return {type: 'inputs', index: id-1}
	}

	else if (id === 1000) {
		return {type: 'colorbars'}
	}

	else if (id < 2001) {
		return {type: 'undefined'}
	}

	else if (id < 3010) {
		return {type: 'colors', index: id%1000 - 1}
	}

	else if (id < 4010) {
		if (id%10 === 0) {
			return {type: 'mediaPlayers', index: (id - 3010) / 10 }
		}
		else if (id%10 == 1) {
			return {type: 'mediaPlayerKeys', index: (id - 3011) / 10 }
		}
	}

	else if (id < 5010) {
		return {type: 'keyMasks', index: (id - 4010) / 10 }
	}

	else if (id < 7001) {
		return {type: 'downStreamKeyMasks', index: (id - 5010) / 10 }
	}

	else if (id < 8001) {
		return {type: 'cleanFeeds', index: id - 7001 }
	}

	else if (id < 10010) {
		return {type: 'auxiliaries', index: id - 8001 }
	}

	else if (id == 10010) {
		return {type: 'program'}
	}

	else if (id == 10011) {
		return {type: 'preview'}
	}

	else {
		return {type: 'Unknown source'}
	}
}

/**
 * Provides an easy way to connect to an ATEM. If a valid IP address is provided, {@link Device#connect} will be called automatically.
 * @param [atemIpAddress] {String} The ip address of the ATEM to connect to.
 * @constructor Device
 */
function Device(atemIpAddress){
	var self = this, atem = this;
	if (!(self instanceof Device))
		throw new Error('use "new" to construct an ATEM Device');

	/** Create a UDP v4 socket */
	var socket;

	/** Call the constructor of EventEmitter */
	events.EventEmitter.call(this);

	/**
	 * The ip address of the ATEM
	 * @name Device#ip
	 * @type String
	 */
	Object.defineProperty(this, 'ip', {
		set: function (ipString) {
			if (net.isIPv4(ipString)) {
				if (atem.state !== ConnectionState.closed) {
					atem.disconnect(function() {
						ip = ipString;
						atem.connect();
						atem.emit('addressChange', ip);
					});
				} else {
					ip = ipString;
					atem.emit('addressChange', ip);
				}
			}
			else {
				const err = new Error('Invalid IP address: ' + ipString);
				this.emit('error', err);
			}
		},
		get: function () { return ip }
	});

	/**
	 * The current state of the connection.
	 * For more information about the possible values see {@link ConnectionState}
	 *
	 * @name Device#state
	 * @type {ConnectionState}
	 */
	Object.defineProperty(this, 'state', {
		get: function() {return state},
		set: function(newValue) {
			state = newValue;
			/**
			 * @event Device#connectionStateChange
			 * @property {ConnectionState} state The new state
			 */
			atem.emit('connectionStateChange', state);
			if (state == 2) { atem.emit('connected'); }
		}
	});

	var
		/**
		 * Unique identifier
		 * A temporary uid is generated to make a connection.
		 * When connected, the ATEM will provide another uid for us
		 * @type {number}
		 */
		uid,
		/**
		 * The current local sequence number.
		 * Local sequence numbers are used to identify sync packets we send to the ATEM.
		 * @type {Number}
		 */
		ls = 0,
		/**
		 * Packets we sent to the ATEM but for which we received no acknowledgement yet.
		 * @type {UserPacket[]}
		 */
		pendingPackets = [],
		/**
		 * Packets the ATEM sent and have yet to be acknowledged
		 * @type {AtemPacket[]}
		 */
		incomingPackets = [],
		/**
		 * Commands we need to send to the atem
		 * @type {Command[]}
		 */
		commandQueue = [],
		/**
		 * A timer to ensure commands are sent within 16 milliseconds
		 * @type {Timeout}
		 */
		commandTimer,
		/**
		 * A timer to assure there is a sync message sent every 600 milliseconds.
		 * @type {Timer}
		 */
		syncInterval,
		/**
		 * The timeout of the last received ATEM packet. Used to detect connection loss.
		 */
		communicationTimeout,
		ip,
		state = ConnectionState.closed;

	/**
	 * When an error is encountered during communication, this event will be fired.
	 * @event Device#error
	 * @type {Error}
	 * @property {String} Message
	 */

	/**
	 * Find a pending packet by local sequence number
	 * @param {Number} ls Local sequence number
	 * @return {UserPacket} The packet
	 */
	function getPendingPacket(ls){
		var i;
		for (i = pendingPackets.length - 1; i >= 0; i--)
			if (pendingPackets[i].header.ls == ls)
				return pendingPackets[i];
	}

	/**
	 * Create and transmit a sync packet to the ATEM.
	 */
	function sync() {
		const packet = new UserPacket();
		packet.transmit();
	}



	/**
	 * Create a custom UserPacket.
	 *
	 * @constructor UserPacket
	 * @augments Packet
	 * @classdesc A Packet commissiond by the user. This is used to send messages to the ATEM.
	 *
	 * @param {Command[]|null} [commands] An array of commands. If null, a connect packet will be created
	 */
	function UserPacket(commands){
		Packet.call(this);
		this.interval = undefined;

		// If the packet contains commands
		if (typeof commands !== 'undefined'){
			// If it is a connect packet
			if (commands === null) {
				this.header.flags = flags.connect;
				this.body.commands = [{
					get length() { return 8; },
					serialize: function() {
						const connectCmd = '0100000000000000';
						return (new Buffer(connectCmd, 'hex'));
					}
				}];
			}
			else {
				this.body.commands = commands;
				this.header.flags = flags.sync;
			}
		}

		// If the packet contains no commands
		else {
			this.header.flags = flags.sync;
		}
	}
	util.inherits(UserPacket, Packet);
	/**
	 * Transmits the packet to the atem
	 * @memberof UserPacket
	 * @method
	 * @fires Device#error
	 * @fires Device#messageTimeout
	 */
	UserPacket.prototype.transmit = function() {
		var self = this;

		if (!this.isAck()) {
			if (incomingPackets.length > 0) {
				this.header.flags |= flags.ack; //enable ack flag
				this.header.fs = incomingPackets.shift().header.ls;
			}
			else {
				this.header.flags &= ~flags.ack; //disable ack flag
				this.header.fs = 0;
			}
		}

		// If it's the first time this packet is sent
		if (pendingPackets.indexOf(this) == -1 && !this.serializedCache) {
			this.header.uid = uid;

			if ( this.isSync() || this.isConnect() ) {
				this.header.ls = ls;
			}

			if ( atem.state == ConnectionState.open && this.isSync() && this.header.ls>0 && commandQueue.length>0){
				// first sync packet cannot contain data.
				this.body.commands = this.body.commands.concat(commandQueue.slice(0));
				commandQueue = [];
			}

			this.serializedCache = this.body.serialize();
			var packet = Buffer.concat([this.header.serialize(), this.serializedCache]);
			socket.send(packet, 0, packet.length, 9910, atem.ip, function(err, bytes) {
				if (err) atem.emit('error', err);
			});

			// Set the repeat flag for future transmissions
			self.header.flags |= flags.repeat;

			// Take measures for packet loss
			if (self.isSync() || self.isConnect()) {
				self.interval = setInterval(function() {self.transmit();} , 600);

				pendingPackets.push(self);
				self.messageTimeout = setTimeout(function() {
					/**
							 * When a sync message is sent to the atem and the ATEM does not
							 * respond in x milliseconds, this event will be fired.
							 *
							 * @event Device#messageTimeout
							 * @type {Error}
							 * @property message {String} The error message
							 */
					//Todo parametrize timeout
					atem.emit('messageTimeout', new Error('Sync timeout (1sec)'));
				}, 1000);
			}

			if (state != ConnectionState.attempting && this.isSync()){
				ls = (ls+1) %0x10000;
			}

		}

		// If it is a retransmission
		else {
			packet = Buffer.concat([this.header.serialize(), this.serializedCache]);
			socket.send(packet, 0, packet.length, 9910, atem.ip);
		}

		if (this.isSync() && state == ConnectionState.open){
			clearInterval(syncInterval);
			syncInterval = setInterval(sync, 600);
		}
	};
	/**
	 * Mark this packet as read. It deletes this packet
	 * from {@link Device~pendingPackets the pendingPackets list} and stops retransmitting this packet.
	 * @memberof UserPacket
	 * @method
	 */
	UserPacket.prototype.markAsRead = function() {
		clearInterval(this.interval);
		clearTimeout(this.messageTimeout);
		pendingPackets.splice(pendingPackets.indexOf(this), 1);
	};


	/**
	 * Parse an ATEM UDP message
	 *
	 * @constructor AtemPacket
	 * @augments Packet
	 * @classdesc Used to parse an UDP message from the Atem
	 *
	 * @param {Buffer} msg The message to parse
	 */
	function AtemPacket(msg){
		Packet.call(this);

		this.header.flags = msg[0]>>>3;
		this.header.uid = msg.readUInt16BE(2);
		this.header.fs  = msg.readUInt16BE(4);
		this.header.ls  = msg.readUInt16BE(10);

		if ((this.header.flags & flags.unknown) == flags.unknown) console.log('Unknown Packet flag!');

		if (state === ConnectionState.attempting) {
			if (this.isSync()){
				atem.state = ConnectionState.establishing;
				uid = this.header.uid;
			}
		} else
		if (state === ConnectionState.establishing){
			if (msg.length==12 && !this.isConnect()){
				atem.state = ConnectionState.open;
				clearInterval(syncInterval);
				syncInterval = setInterval(sync, 600);
			}
		}

		if (this.isConnect()) {
			//Do something
		}
		else if ((msg.length == (msg.readUInt16BE(0)&0x7FF) && this.header.uid == uid)){
			const body = msg.slice(12);

			var name, data, cmd, cmdLength, cursor=0;
			while (cursor < body.length-1) {
				cmdLength = body.readUInt16BE(cursor);
				name = body.toString('utf8', cursor+4, cursor+8);
				data = body.slice(cursor+8, cursor+cmdLength);
				cmd = new Command(name, data);
				this.body.commands.push(cmd);
				cursor += cmdLength;

				/**
				 * @event Device#rawCommand
				 * @type {Command}
				 */

				// todo: check foreign sequence number, to prevent the event emitter
				// from emitting the same message twice.
				atem.emit('rawCommand', cmd);
				atem.emit(cmd.name, cmd.data);
			}
		}
		else if (msg.length != (msg.readUInt16BE(0)&0x7FF)) {
			const err = new Error('Message length mismatch');
			self.emit('error', err);
		} else {
			const err2 = new Error('UID mismatch');
			self.emit('error', err2);
		}
	}
	util.inherits(AtemPacket, Packet);
	/**
	 * Send an acknowledgement for this packet to the ATEM
	 * @memberof AtemPacket
	 * @method
	 */
	AtemPacket.prototype.acknowledge = function(){
		const self = this;

		incomingPackets.push(self);
		if (state == ConnectionState.attempting)
			respond();
		else
			process.nextTick(respond);

		function respond() {
			const index = incomingPackets.indexOf(self);
			if (index != -1) {
				const ackPacket = new UserPacket();
				ackPacket.header.flags = flags.ack;
				ackPacket.header.fs = self.header.ls;
				ackPacket.transmit();
				incomingPackets.splice(index, 1);
			}
		}
	};
	/**
	 * Marks the corresponding (sync) UserPacket from the {@link Device~pendingPackets the pendingPackets list} as read. <br>
	 * Note that packets, transmitted before the corresponding packet
	 * (thus having a local sequence number wich is less than the corresponding packet's one),
	 * will be removed too.
	 * @memberof AtemPacket
	 * @method
	 */
	AtemPacket.prototype.removePendingPackets = function() {
		for ( var i = 0; i < pendingPackets.length; i++ ) {
			if (pendingPackets[i].header.ls <= this.header.fs) {
				pendingPackets[i].markAsRead();
			}
		}
	};


	/**
	 * Sends a packet with all the remaining command of the commandQueue
	 */

	function handleQueue() {
		const count = commandQueue.length

		if (count>0) {
			const packet = new UserPacket(commandQueue.slice(0));
			commandQueue = [];

			packet.transmit();
		}

		return count
	}




	this.sendCommand = function(cmd) {
		commandQueue = commandQueue.concat(cmd);
		if (ls>0 && state==ConnectionState.open && !commandTimer){
			commandTimer = setTimeout(function() {
				if (commandQueue.length > 0) sync();
				commandTimer = undefined;
			}, 16);
		}
	};

	/**
	 * Performs a cut transition between preview and program
	 * @function Device#cut
	 */
	this.cut = function() {
		const data = new Buffer(4);
		data.fill(0);
		self.sendCommand(new Command('DCut', data));
	};

	/**
	 * Performs an auto transition between preview and program
	 * @function Device#auto
	 */
	this.auto = function() {
		const data = new Buffer(4);
		data.fill(0);
		self.sendCommand(new Command('DAut', data));
	};

	/**
	 * Changes the specified options of the Source Configuration. Note that you don't need to specify all
	 * the properties of {@link SourceConfiguration}.
	 * @function Device#changeSourceConfiguration
	 * @param {SourceID} sourceID
	 * @param {SourceConfiguration} options
	 */
	this.changeSourceConfiguration = function(sourceID, options) {
		/**
		 * @typedef {Object} SourceConfiguration
		 * @property {String} name The display name of the source. This name is shown for each source on the multiview
		 * @property {String} abbreviation An abbreviation of the display name.
		 * this abbreviation is displayed on the ATEM switcher panels.
		 * @property {VideoInterface} videoInterface The video interface used for this source
		 */

		//todo check if source exists
		//todo laten werken voor multiview
		const data = new Buffer(32);

		const longNameFlag = options.hasOwnProperty('name');
		const shortNameFlag  = options.hasOwnProperty('abbreviation');
		const videoInterfaceFlag = options.hasOwnProperty('videoInterface');

		data[0] = longNameFlag<<0 |
			shortNameFlag<<1 |
			videoInterfaceFlag<<2;

		data.writeUInt16BE(sourceID, 2);

		if (longNameFlag){
			data.write(options.name.slice(0,20), 4);
			if (options.name.length<20)
				data[4+options.name.length] = 0;
		}

		if (shortNameFlag) {
			data.write(options.abbreviation.slice(0,4), 24);
			if (options.abbreviation.length<4)
				data[24+options.abbreviation.length] = 0;
		}

		if (videoInterfaceFlag) {
			data.writeUInt16BE(videoInterfaceNumbers[options.videoInterface], 28)
		}

		self.sendCommand(new Command('CInL', data));
	};

	/**
	 * Sets the desired source in program. (cut transition)
	 * @function Device#setProgram
	 * @param {SourceID} sourceID the ID of the source
	 */
	this.setProgram = function(sourceID) {
		var data = new Buffer(4);
		data.writeUInt32BE(sourceID, 0);

		const cmd = new Command('CPgI', data);
		atem.sendCommand(cmd);
	};

	/**
	 * Sets the desired source in preview
	 * @function Device#setPreview
	 * @param {SourceID} sourceID the ID of the source
	 */
	this.setPreview = function(source) {
		var data = new Buffer(4);
		data.writeUInt32BE(source, 0);

		const cmd = new Command('CPvI', data);
		atem.sendCommand(cmd);
	};

	/**
	 * Change the auxiliary output
	 * @param {SourceID} aux
	 * @param {SourceID} source
	 */
	this.setAux = function(aux, source){
		var data = new Buffer(4);
		data[0] = 1;
		data[1] = aux - 8001;
		data.writeUInt16BE(source, 2);

		const cmd = new Command('CAuS', data);
		atem.sendCommand(cmd);
	}




	this.on('connected', function() {
		sync();
	});

	this.on('messageTimeout', function() {

	});

	this.on('connectionLost', function() {
		console.log('Connection Lost');
		atem.disconnect(atem.connect);
	});

	this.on('InPr', function(d) {
		const sourceID = d.readUInt16BE(0);

		const longName = parseString(d.slice(2,22));
		const shortName = parseString(d.slice(22, 26));
		const videoInterface = videoInterfaceNames[d[29]];
		if (typeof videoInterface === 'undefined')
			console.log('unknown video interface ' + d[29]);

		/**
		 * When the Source Configuration changes, for example: if the display name of input 2 changes, this event will be fired
		 *
		 * @event Device#sourceConfiguration
		 * @property {SourceID} sourceID the identifier of the source
		 * @property {SourceConfiguration} sourceConfiguration the new configuration of the source
		 */
		atem.emit('sourceConfiguration', sourceID, {
			name: longName,
			abbreviation: shortName,
			'videoInterface': videoInterface
		});
	});

	this.on('TlIn', function(d) {
		const length = d.readUInt16BE(0);
		for (var i=2; i<length+2; i++){
			/**
			 * When the input tally changes, this event will be fired. <br>
			 * By input tally we mean the state (which is: live, preview or neither of them) of one of the camera inputs
			 *
			 * @event Device#inputTally
			 * @property {Number} inputNumber the index of the input
			 * @property {SourceState} state
			 */
			atem.emit('inputTally', i-1, {
				program: (d[i] & 1) === 1,
				preview: (d[i] & 2) === 2
			});
		}
	});

	this.on('TlSr', function(data) {
		const length = data.readUInt16BE(0)*3 + 2;
		var source, tallyBit;
		for (var i=2; i<length; i = i+3){
			/**
			 * When the source tally changes, this event will be fired. <br>
			 *
			 * @event Device#sourceTally
			 * @property {Number} sourceID the id of the source
			 * @property {SourceState} state
			 */

			source = data.readUInt16BE(i);
			tallyBit = data[i+2];

			atem.emit('sourceTally', source, {
				program: (tallyBit & 1) === 1,
				preview: (tallyBit & 2) === 2
			});
		}
	});

	this.on('PrvI', function(d) {
		const me = d.readUInt8(0);
		const source = d.readUInt16BE(2)
			inTransition = (d[4] & 1) === 1;

		/**
		 * When the selected preview bus changes this event will be fired.
		 * @event Device#previewBus
		 * @property {number} me 0 for M/E 1, 1 for M/E 2
		 * @property {number} source The new preview source
		 * @property {boolean} inTransition Is this currently dissolving?
		 */
		atem.emit('previewBus', {
			me,
			source, 
			inTransition
		});

		// todo inspect the other bytes in PrvI
	});

	this.on('PrgI', function(d) {
		const me = d.readUInt8(0);
		const source = d.readUInt16BE(2);

		/**
		 * When the selected program bus changes this event will be fired.
		 * @event Device#programBus
		 * @property {number} me 0 for M/E 1, 1 for M/E 2
		 * @property {number} source The new program source
		 */
		atem.emit('programBus', {
			me,
			source
		});
		// todo inspect the other bytes in PrgI
	});

	this.on('AuxS', function(d) {
		const aux = d[0] + 8001;
		const source = d.readUInt16BE(2);

		/**
		 * When an auxiliary output changes, this event will be fired.
		 * @event Device#auxiliaryOutput
		 * @property {SourceID} aux The id of the auxiliary output
		 * @property {SourceID} source The id of the source that is assigned to the auxiliary output
		 */
		atem.emit('auxiliaryOutput', aux, source);
	});

	this.on('_pin', function(data) {
		const productName = parseString(data);
		atem.emit('productNameChange', productName);
	});




	/**
	 * Initiate a new connection. If already connected it will first disconnect.
	 * @name Device#connect
	 * @method
	 */
	this.connect = function() {

		if (atem.state === ConnectionState.closed) {
			uid = Math.round(Math.random() * 0x7FF);
			ls = 0;

			if (atem.ip) {
				atem.state = ConnectionState.attempting;

				socket = dgram.createSocket('udp4');
				socket.on('message', messageHandler);

				const connectPacket = new UserPacket(null);
				connectPacket.transmit();
			} else {
				const err = new Error('IP not set');
				atem.emit('error', err);
			}

		} else {
			atem.disconnect(atem.connect);
		}
	}

	this.disconnect = function(callback) {
		console.log('Disconnecting');

		clearInterval(syncInterval);
		clearTimeout(communicationTimeout);
		pendingPackets.forEach(function(packet) {
			packet.markAsRead();
		});
		atem.state = ConnectionState.closed;

		if (socket) socket.close();

		if (callback) callback();
	}

	function messageHandler(msg, rInfo) {
		const packet = new AtemPacket(msg);

		if (uid == packet.header.uid || packet.isConnect()) {
			if (packet.isAck() || packet.isConnect())
				packet.removePendingPackets();

			if (state!=ConnectionState.establishing && packet.isSync() || packet.isConnect())
				packet.acknowledge();

			clearTimeout(communicationTimeout);
			if (!packet.isConnect()) {
				communicationTimeout = setTimeout(function() {
					/**
					 * When the connection with the atem is lost, this event will be fired.
					 * @event Device#connectionLost
					 */
					atem.emit('connectionLost');
				}, 800);
			}
		}
	}

	// set ip if provided
	if (typeof atemIpAddress != 'undefined') {
		this.ip = atemIpAddress;
		this.connect();
	}
}


// Let Device inherit from the EventEmitter
util.inherits(Device, events.EventEmitter);


/**
	 * @constructor Packet
	 * @classdesc {@link Packet} is an abstract prototype used by {@link UserPacket} and {@link AtemPacket}
	 * @namespace Packet
	 * @fires Device#error
	 */
function Packet() {
	var self = this;

	const headerLength = 12;

	/**
		 * Represents the first 12 bytes of the serial packet
		 * @member Packet#header
		 *
		 * @property {Number} flags - See {@link flags}
		 * @property {Number} uid - See {@link Device~uid Device ~ uid}
		 * @property {Number} ls - Local sequence number
		 * @property {Number} fs - Foreign sequence number
		 * @property {Number} packetLength - The length of the serial packet
		 * @property {method} serialize() - Converts the header into a buffer
		 */
	this.header = {
		flags: undefined,
		uid: undefined,
		ls: undefined,
		fs: undefined,
		get packetLength() {
			return headerLength + self.body.length;
		},
		set packetLength(val){
			const err = new Error('packetLength cannot be changed manually. You need to change the body');
			atem.emit('error', err);
		},
		serialize: function() {
			var header = new Buffer(12);

			// Package length and flags
			header.writeUInt16BE(this.packetLength, 0);
			header[0] |= (this.flags<<3);

			// UID
			header.writeUInt16BE(self.header.uid, 2);

			// Foreign sequence number
			if (self.isAck()) header.writeUInt16BE(this.fs, 4);

			// Zeros
			header.fill(0, 6, 10);

			// Local sequence number
			if (self.isSync() || self.isConnect()) header.writeUInt16BE(this.ls, 10);

			return header;
		}
	};

	/**
		 * @member Packet#body
		 *
		 * @property {Command[]} commands - An array containing all the commands in the Packet
		 * @property {Number} length - The serialized body's length
		 * @property {method} serialize - Convert the body to a buffer
		 */
	this.body = {
		commands: [],
		get length() {
			var length = 0;
			this.commands.forEach(function(command) {
				length += command.length
			});
			return length
		},
		set length(newLength){
			const err = new Error('length cannot be changed manually. You need to add/remove commands');
			atem.emit('error', err);
		},
		serialize: function() {
			const serializedCommands = this.commands.map(function(cmd) {
				return cmd.serialize();
			});

			return Buffer.concat(serializedCommands);
		}
	};
}
Packet.prototype.isSync = function() {
	return (this.header.flags & flags.sync) == flags.sync;
};
Packet.prototype.isConnect = function() {
	return (this.header.flags & flags.connect) == flags.connect;
};
Packet.prototype.isAck = function() {
	return (this.header.flags & flags.ack) == flags.ack;
};


/**
 * Creates a new ATEM command
 *
 * @constructor Command
 * @classdesc An ATEM command
 *
 * @param {String} name - An ATEM command (e.g. 'TlSr') consisting of 4 characters.
 * @param {Buffer} [data] - A buffer containing command data.
 */
var Command = Device.Command = function(name, data) {
	/**
	 * The name of the command.
	 * @name Command#name
	 * @type String
	 */
	this.name = name;

	/**
	 * The command data.
	 *
	 * @name Command#data
	 * @type Buffer
	 */
	if (data)
		this.data = data;
	else
		this.data = new Buffer(0);

	/**
	 * The number of bytes this command will take when serialized.
	 *
	 * @name Command#length
	 * @type Number
	 */
	Object.defineProperty(this, 'length', {
		get: function() {
			return 8 + this.data.length;
		},
		set: function() {
			var err = new Error('property length of a Command cannot be set. You need to change the data property to change the length');
			throw err;
		}
	});
};
/**
 * Converts the command to a byte array
 * @returns {Buffer} A Buffer containing the command name and data.
 */
Command.prototype.serialize = function() {
	const l = this.length;
	const header = new Buffer(8);

	header.writeUInt16BE(l, 0);
	header.write(this.name, 4);

	return Buffer.concat([header, this.data]);
};


Device.ConnectionState = ConnectionState;
Device.getSourceInfo = getSourceInfo;

module.exports = Device;

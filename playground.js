var Atem = require('./index');
var Colors = require('colors');

var d = new Atem('10.1.0.215');

console.log('state: ' + d.state);

d.on('connectionStateChange', function(state) {
	console.log('state changed: ' + state);
});

//d.on('sourceConfiguration', function (source, conf, info) {
//	if (d.state == 2) console.log(info, conf);
//});

d.on('connectionLost', function() {console.log("Connection Lost!".red)});

//d.on('rawCommand', function(cmd) {
//	var data;
//	if (cmd.data.length > 50) {
//		data = '('.grey + String(cmd.data.length).grey + ')'.grey;
//	} else {
//		data = cmd.data;
//	}
//	console.log(cmd.name.grey, data);
//});

d.on('error', function(e) {console.log(e)});

d.on('AuxS', function(cmd) {
	var data;
	if (cmd.length > 50) {
		data = '('.grey + String(cmd.length).grey + ')'.grey;
	} else {
		data = cmd;
	}
	console.log('AuxS'.grey, data);
});


d.changeSourceConfiguration(0, {name: 'Zwartje', abbreviation: 'ZWRT'})

d.on('error', function(e) {console.trace(e);});


setTimeout(d.connect, 4000);

//d.on('TrPs', function(d) {
//	var s = '';
//	for (var i = 0; i<d.length; i++){
//		s += pad(d[i].toString(2), 8) + " ";
//	}
//	console.log(d,s);
//});

//var shortName = 'Cam';
//var dots = '';
//setInterval(function() {
//	shortName = shortName=='Cam'?'CAM':'Cam';
//	dots = dots=='' ? '.' : (dots=='.'? '..' : (dots=='..' ? '...' : ''));
//	d.changeInputConfig(2, shortName+'2', 'Camera 2'+dots);
//}, 2000);

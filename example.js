const Atem = require('./');
const atem = new Atem();

atem.on('connectionStateChange', function(state) {
	console.log('state', state);
});

atem.on('productNameChange', function(name) {
	console.log('name', name);
});

atem.on('sourceConfiguration', function(id, config, info) {
	console.log(id, info, config.videoInterface);
});

atem.on('programBus', function(source) {
	console.log('program bus changed to', source);
});

atem.ip = "10.1.0.210";
atem.connect();
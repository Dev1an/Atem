# Atem

Implementation of BlackMagicDesign's ATEM communication protocol (version 6.8) in javascript (written for nodejs).

[![Join the chat at https://gitter.im/Dev1an/Atem](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/Dev1an/Atem?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
![Licensed under MIT](https://img.shields.io/badge/License-MIT-blue.svg)

### ⚠️ Recent development 🚨

This library is more than 3 years old and although I am still maintaining it, I started a new version of the implementation written from the ground up in Swift. It is developed under [Swift-Atem](https://github.com/Dev1an/Swift-Atem) and implements the protocol in a more flexible manner. The same code can be used to implement both directions of the protocol. This means that you can not only use it to control atem switchers but also to connect to your control panels without the need for a switcher. Opening a whole new world of applications for the Atem control panels.

## Usage
### Connect to an atem
To connect to an atem, simply create a new `Atem` instance and pass an IP address as first parameter of the constructor:
```js
var Atem = require('atem') // Load the atem module
var myAtemDevice = new Atem("10.1.0.9") // Create a new Atem instace with an IP address
```
You can also create a new `Atem` instance and specify the IP address later on. Notice that if you do this, you need to call the `connect` method yourself:
```js
var Atem = require('atem') // Load the atem module
var myAtemDevice = new Atem() // Create a new Atem instace without an IP address
myAtemDevice.ip = "10.1.0.9" // specify the ip address
myAtemDevice.connect() // manually connect to the atem
```
### Receive notifications from your atem
To receive notifications about the connection state:
```js
var Atem = require('atem') // Load the atem module
var myAtemDevice = new Atem() // Create a new Atem instace without an IP address
myAtemDevice.on('connectionStateChange', function(state) {
  console.log('state', state);
});
```

These events are currently implemented: 
- previewBus
- programBus
- inputTally
- sourceTally
- sourceConfiguration
- auxiliaryOutput
- connectionStateChange
- connectionLost

If you need other events, create an issue. You can also fall back to the `rawCommand` event and interpret the raw data coming from the atem yourself.

You can read more about all the available events in the [API reference](http://dev1an.github.io/Atem/Device.html)

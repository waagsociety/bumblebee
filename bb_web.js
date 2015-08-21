//bumblebee web application
//streams transformed data to web browser, by means of socket.io

var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var bb = require('./bb');

//main entry point
app.get('/', function(req, res){
	res.sendFile(__dirname + '/index.html');
	setTimeout(function(){ start(); }, 1000);
});

app.use(express.static('public'));

function start()
{
	//for now hardcoded
	//TODO: make configurable / create GUI for this.
	var c = 'conf/tnl/tnl_schema.yaml';
	var m = 'conf/tnl/mappings/parlement_levend.yaml';
	var d = 'data/TblParlement_Levend.csv';

	//for now just pass each result of the transformation through to the browser via socket.io
	var context = bb.transformFile(c, m, d, function(result){
		io.sockets.emit('row', result); //send to all sockets
		process.stdout.write(".");
	});
	
	//send the context to the browser so we can use it for creating tables etc.
	io.sockets.emit('header', context);
}


http.listen(3000, function () {
	
	console.log('listening on http://%s:%s', '*', 3000);
});

//basic socket io connection detection
io.on('connection', function(socket)
{
	console.log('a user connected');

	socket.on('disconnect', function(){
		console.log('user disconnected');
	});

});

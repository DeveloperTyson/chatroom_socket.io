// Setup basic express server
var express = require('express');
var app = express();
var path = require('path');
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var port = process.env.PORT || 8080;
var mongo = require('mongodb').MongoClient;

server.listen(port, function () {
  console.log('Server listening at port %d', port);
});

// Routing
app.use(express.static(path.join(__dirname, 'public')));

// Chatroom

mongo.connect('mongodb://127.0.0.1/mongochat', function(err, client) {

    if (err) {
        throw err;
    }

    console.log('MongoDB connected...');

    const db = client.db("local");
    const chatCollection = db.collection('chats');
    const roomCollection = db.collection('rooms');

    roomCollection.updateMany({},{ $set: { numUsers : 0 } }, function(err, result) {});

    io.on('connection', function (socket) {
        var addedUser = false;
        var numUsers = 0;

        // when the client emits 'new message', this listens and executes
        socket.on('new message', function (data) {
            // we tell the client to execute 'new message'
            socket.to(socket.chatRoom).emit('new message', {
                username: socket.username,
                message: data
            });

            //Insert to DB
            chatCollection.insert({username: socket.username, message: data,chatRoom:socket.chatRoom},
                function(err, result){
                    //console.log(result)
                });

        });

        // when the client emits 'add user', this listens and executes
        socket.on('add user', function (data) {

            if (addedUser) return;
            // we store the username and chat room name in the socket session for this client
            socket.username = data.username;
            socket.chatRoom = data.chatRoom;

            //Prevent null data attack
            if(socket.username === 'undefined' || socket.chatRoom === 'undefined') return

            //Subscribe the socket to a given channel
            socket.join(socket.chatRoom);

            chatCollection.find({'chatRoom':socket.chatRoom}).limit(100).sort({_id:-1}).toArray(function(err, res){
                if(err){
                    throw err;
                }
                // Emit the messages
                socket.emit('display record', res);

                roomCollection.find({'chatRoom':socket.chatRoom}).toArray(function(err, docs) {
                    numUsers = docs[0].numUsers;

                    numUsers++;

                    roomCollection.updateOne({ chatRoom : socket.chatRoom },
                        { $set: { numUsers : numUsers } }, function(err, result) {
                            //console.log(numUsers);
                            //console.log(result);
                        });

                    addedUser = true;
                    socket.emit('login', {
                        numUsers: numUsers
                    });
                    // echo selected room (all clients) that a person has connected
                    socket.to(socket.chatRoom).emit('user joined', {
                        username: socket.username,
                        numUsers: numUsers
                    });

                });
            });

        });

        // when the client emits 'typing', we broadcast it to others
        socket.on('typing', function () {
            socket.to(socket.chatRoom).emit('typing', {
                username: socket.username
            });
        });

        // when the client emits 'stop typing', we broadcast it to others
        socket.on('stop typing', function () {
            socket.to(socket.chatRoom).emit('stop typing', {
                username: socket.username
            });
        });

        // when the user disconnects.. perform this
        socket.on('disconnect', function () {
            if (addedUser) {
                roomCollection.find({'chatRoom':socket.chatRoom}).toArray(function(err, docs) {
                    numUsers = docs[0].numUsers;

                    --numUsers;

                    roomCollection.updateOne({ chatRoom : socket.chatRoom },
                        { $set: { numUsers : numUsers } }, function(err, result) {});

                    // echo globally that this client has left
                    socket.to(socket.chatRoom).emit('user left', {
                        username: socket.username,
                        numUsers: numUsers
                    });

                });

            }
        });

        //when the user requested list.. perform this
        socket.on('get list', function () {
            roomCollection.find().toArray(function(err, docs) {
                socket.emit('display list',docs);
            });
        });

        //
        socket.on('create room', function (data) {
            roomCollection.insertOne({chatRoom:data,numUsers:0},function () {
                socket.emit('new room', data);
                socket.broadcast.emit('new room', data);
            });
        });
    });

});
const express = require('express');

const app = express();
const path = require('path');
const server = require('http').createServer(app);
const socketio = require('socket.io');
const fs = require('fs');

const PORT = process.env.PORT || process.env.NODE_PORT || 3000;
let dictionary;
app.get('/', (req, res) => {
  res.sendFile(path.join(`${__dirname}/../client/client.html`));
});
app.get('/styles.css', (req, res) => {
  res.sendFile(path.join(`${__dirname}/../client/styles.css`));
});

// got a list of words from here
// https://www.thegamegal.com/printables/
fs.readFile(`${__dirname}/../src/words.txt`, (err, data) => {
  dictionary = data.toString('utf-8').split('\n');
});

server.listen(process.env.PORT || 3000);


console.log(`Listening on 127.0.0.1: ${PORT}`);

const io = socketio(server);
const users = {};
let drawerList = [];
let indexDrawer = 0;
let lineToDraw = [];
let word;
let guessedCorrect = false;
// to store chat log, so that new users can get updated on ongoing conversation
let chat = '';
const onJoined = (sock) => {
  const socket = sock;

  socket.on('join', (data) => {
    const joinMsg = {
      name: 'server',
      msg: `There are ${Object.keys(users).length} users online`,
    };
    /*
    if there is currently a conversation in the chat room,
    update the chat log of the client that has entered since the conversation started
    */
    if (chat.length > 0) {
      socket.emit('updateChat', chat);
    }
    // updates new user with drawn lines
    if (Object.keys(lineToDraw).length > 0) {
      socket.emit('updateCanvas', lineToDraw);
    }
    // Returned to client for chat window telling how many that's currently on the serveR
    socket.emit('chatWindow', `Server: ${joinMsg.msg}`);
    socket.name = data.name;
    users[socket.name] = socket.name;

    socket.join('room1');
    socket.emit('msg', joinMsg);
    const response = {
      name: 'server',
      msg: `${data.name} has joined the room.`,
    };
    // create object with user info to be stored in queue of drawers
    // need socket.id to send personal info to specific user when chosen
    // to be a drawer, or guessed correctly
    const obj = { id: socket.id, name: socket.name };
    // add user to drawer queue
    drawerList.push(obj);
    // if this is the first that enters chat
    // then this is the drawer
    if (Object.keys(users).length === 1) {
      // indexDrawer = 0;
      socket.emit('updateDrawer', true);
      // get a random word from list
      word = dictionary[Math.floor(Math.random() * dictionary.length)];
      // send specifically to this user
      io.to(drawerList[0].id).emit('updateWordToDraw', word);
    }
    // tell all other clients that the client has joined the room
    socket.broadcast.emit('chatWindow', `Server: ${response.msg}`);
    socket.broadcast.to('room1').emit('msg', response);
    console.log(`${data.name} joined`);
    socket.emit('msg', { name: 'server', msg: 'You joined the room' });
    // message from server to client that the person has joined the room
    socket.emit('chatWindow', 'Server: You joined the room');
  });
};

// is called when the round is over, prompt change of drawer
const nextRound = (sock) => {
  const socket = sock;
  socket.on('roundOver', () => {
    // clear storage
    lineToDraw = [];
    guessedCorrect = false;
    // tell client that he is not longer a drawer
    io.to(drawerList[indexDrawer].id).emit('updateDrawer', false);
    // jump to next in queue
    indexDrawer++;
    // unless we hit last index, then start over
    if (indexDrawer === drawerList.length) {
      indexDrawer = 0;
    }
    // tell next client he is the drawer
    io.to(drawerList[indexDrawer].id).emit('updateDrawer', true);
    // get a new random word
    word = dictionary[Math.floor(Math.random() * dictionary.length)];
    // send him the word to draw
    io.to(drawerList[indexDrawer].id).emit('updateWordToDraw', word);
    socket.broadcast.emit('clearCanvas');
  });
};

// sends drawing info back and forth
const onDrawer = (sock) => {
  const socket = sock;
  socket.on('drawing-line', (data) => {
    socket.broadcast.emit('drawing-line', data);
  });
  socket.on('drawing-line', (data) => {
    socket.broadcast.emit('drawing-line', data);
  });
  // get the lines to store
  socket.on('sendLinesStorage', (data) => {
    lineToDraw.push(data);
  });
  // clear canvas of all
  socket.on('clearCanvas', () => {
    lineToDraw = [];
    io.sockets.emit('clearCanvas');
  });
};

const onMsg = (sock) => {
  const socket = sock;
  // gets message from client
  socket.on('msgToServer', (data) => {
    let msg = '';
    // if th message contains any of these commands
    // then broadcast the action instead of the command
    // action commands: /dance, /wave, /cry, /lol
    if (data.msg === '/dance') {
      io.sockets.in('room1').emit('msg', { name: socket.name, msg: `${socket.name} dances` });
      msg = (`${socket.name} dances`);
    } else if (data.msg === '/wave') {
      io.sockets.in('room1').emit('msg', { name: socket.name, msg: `${socket.name} waves` });
      msg = (`${socket.name} waves`);
    } else if (data.msg === '/cry') {
      io.sockets.in('room1').emit('msg', { name: socket.name, msg: `${socket.name} cries` });
      msg = (`${socket.name} cries`);
    } else if (data.msg === '/lol') {
      io.sockets.in('room1').emit('msg', { name: socket.name, msg: `${socket.name} is laughing out load` });
      msg = (`${socket.name} is laughing out load`);
      // if not a command, then check if the user guessed correct
      // else just post the text
      // send the msg to lower case, makse sure it's not the drawer
      // that's guessing, and make sure no one else guessed correct first
    } else if (data.msg.toLowerCase() === word
               && socket.name !== drawerList[indexDrawer].name
               && !guessedCorrect) {
      guessedCorrect = true;
      io.sockets.in('room1').emit('msg', { name: socket.name, msg: data.msg });
      msg = (`${socket.name}: ${data.msg}`);
      // let the chat room know that this person guessed the correct name
      io.sockets.in('room1').emit('msg', { name: 'Server: ', msg: `${socket.name} was correct!` });
      msg += (`\nServer: ${socket.name} was correct!`);
      for (let i = 0; i < drawerList.length; i++) {
        if (drawerList[i].name === socket.name) {
          io.to(drawerList[i].id).emit('wonRound');
          break;
        }
      }
      io.to(drawerList[indexDrawer].id).emit('successfulDraw');
    } else {
      io.sockets.in('room1').emit('msg', { name: socket.name, msg: data.msg });
      msg = (`${socket.name}: ${data.msg}`);
    }
    chat += (`${msg}\n`);
    io.sockets.emit('chatWindow', msg);
  });
};

const onDisconnect = (sock) => {
  const socket = sock;
  socket.on('disconnect', (data) => {
    console.dir(data);
    const message = `${socket.name} has left the room.`;
    socket.broadcast.to('room1').emit('msg', { name: 'server', msg: message });
    // tell the chat when the client leaves the room
    socket.broadcast.emit('chatWindow', `Server: ${message}`);
    socket.leave('room1');
    // check which object in the list that contains the name of the client
    // that is leaving, then take it out from queue
    for (let i = 0; i < drawerList.length; i++) {
      if (drawerList[i].name === socket.name) {
        drawerList.splice(i, 1);
        break;
      }
    }
    delete users[socket.name];
  });
  // if no users connected anymore, just clean some things up from server
  if (Object.keys(users).length === 0) {
    drawerList = [];
    lineToDraw = [];
  }
};

io.sockets.on('connection', (socket) => {
  console.log('started');
  onJoined(socket);
  onMsg(socket);
  onDisconnect(socket);
  onDrawer(socket);
  nextRound(socket);
});

console.log('Websocket server started');

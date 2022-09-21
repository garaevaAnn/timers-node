require("dotenv").config();

const express = require("express");
const nunjucks = require("nunjucks");

const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const methods = require("./methods/methods")

const WebSocket = require("ws");
const http = require("http");
const cookie = require("cookie");
let DB = null;

const app = express();

const { MongoClient } = require("mongodb");

const server = http.createServer(app);
const wss = new WebSocket.Server({ clientTracking: false, noServer: true });
const clients = new Map();

const clientPromise = MongoClient.connect(process.env.DB_URI, {
  useUnifiedTopology: true,
  maxPoolSize: 10,
});

const getDb = async () => {
  const client = await clientPromise;
  return client.db("users");
};

app.use(async (req, res, next) => {
  try {
    req.db = await getDb();
    console.log('db', req.db)
    next();
  } catch (err) {
    next(err);
  }
});

server.on("upgrade", async (req, socket, head) => {
  console.log('server');
  const cookies = cookie.parse(req.headers.cookie);
  DB = await getDb();
  let user = null;
  try {
    user = await methods.findUserBySessionId(DB, cookies.sessionId);
    if (!user) {
      socket.write("HTTP/1.1 401 Unathorized\r\n\r\n");
      socket.destroy();
      return;
    }
  } catch (err) {
    console.error(err);
    return;
  }

  req.userId = user._id;
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", async (ws, req) => {
   console.log('connection');
  const { userId } = req;
  clients.set(userId, ws);
  ws.on("message", async (message) => {
    let data = null;
    try {
      data = JSON.parse(message.toString());
    } catch {
      return;
    }

    const sendAllTimers = async (userId, ws) => {
      const activeTimers = await methods.findIsActiv(DB,true,userId);
      const oldTimers = await methods.findIsActiv(DB,false,userId);
      ws.send(JSON.stringify({ type: "all_timers", activeTimers, oldTimers }));
    };
    if (data.type === "all_timers") {
      sendAllTimers(userId, ws);
    } else if (data.type === "active_timers") {
      const activeTimers = await methods.findIsActiv(DB,true,userId);
      ws.send(JSON.stringify({ activeTimers }));
    } else if (data.type === "stop_timer") {
      const timerId = await methods.stopTimer(DB, data.timerId)
      ws.send(JSON.stringify({ type: "stop_timer", timerId }));
      sendAllTimers(userId, ws);
    } else if (data.type === "create_timer") {
      const timerId = await methods.createTimer(DB, data.description, userId)//????
      ws.send(JSON.stringify({ type: "create_timer", timerId: timerId.toString() }));
      sendAllTimers(userId, ws);
    }
  });

  const sendActiveTimers = async (userId, ws) => {
    const activeTimers = await methods.findIsActiv(DB,true,userId);
    ws.send(JSON.stringify({ activeTimers, type: "active_timers" }));
  };
  setInterval(() => {
    Array.from(clients.entries()).forEach(([userId, ws]) => sendActiveTimers(userId, ws));
  }, 1000);

  ws.on("close", () => {
    clients.delete(userId);
  });
});

nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});

app.set("view engine", "njk");
app.use(cookieParser());

app.use(express.json());
app.use(express.static("public"));

app.get("/", methods.auth(), (req, res) => {
  console.log('get /')
  res.render("index", {
    user: req.user,
    authError: req.query.authError === "true" ? "Wrong username or password" : req.query.authError,
  });
});

app.post("/login", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;
  const user = await methods.findUserByUserName(req.db, username);
  console.log('user',user);
  if (!user || user.password !== methods.hash(password)) {
    return res.redirect("/?authError=true");
  }
  const sessionId = await methods.createSession(req.db, user._id);
  res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
});

app.post("/signup", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;
  try {
    const db = req.db;
    const result = await db.collection("users").insertOne({
      username: username,
      password: methods.hash(password),
    });
    const sessionId = await methods.createSession(db, result.insertedId);
    res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
  } catch (error) {
    res.status(400).send(error.message);
  }
});

app.get("/logout", methods.auth(), async (req, res) => {
  if (!req.user) return res.redirect("/");
  await methods.deleteSession(req.db, req.sessionId);
  res.clearCookie("sessionId").redirect("/");
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`  server running on http://localhost:${port}`);
});

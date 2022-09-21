const { nanoid } = require("nanoid");
const crypto = require("crypto");
const {  ObjectId } = require("mongodb");

const hash = (password) => {
  const nh = crypto.createHash("sha256").update(password).digest("hex");
  return nh;
};

const findIsActiv = async (db, isActive, userId) => {
  const data = await db.collection("timers").find({ userId: userId, isActive: isActive }).toArray();
  if (isActive) {
    data.forEach((item) => {
      item.progress = Date.now() - item.start;
      item.id = item._id.toString();
    });
  }
  return data;
};

const createTimer = async (db, desc, userId) => {
  const timer = {
    start: Date.now(),
    description: desc,
    isActive: true,
    userId: userId,
  };
  const response = await db.collection("timers").insertOne(timer);
  return response;
};

const stopTimer = async (db, userId) => {
    let col = db.collection("timers");
    const timer = await col
      .findOne({
        _id: ObjectId(userId),
      });
      if(!timer) return 0;
      const { modifiedCount } = await col.updateOne(
          {
            _id: timer._id,
          },
          {
            $set: {
              end: Date.now(),
              isActive: false,
              duration: Date.now() - timer.start,
            },
          }
        );
   return modifiedCount;
};

const findUserByUserName = async (db, username) => db.collection("users").findOne({ username });

const findUserBySessionId = async (db, sessionId) => {
  const session = await db.collection("sessions").findOne(
    { sessionId },
    {
      projection: { userId: 1 },
    }
  );
console.log('sesion', session)
  if (!session) return;

  return db.collection("users").findOne({ _id: ObjectId(session.userId) });
};

const createSession = async (db, userId) => {
  const sessionId = nanoid();

  await db.collection("sessions").insertOne({
    userId,
    sessionId,
  });
  return sessionId;
};

const deleteSession = async (db, sessionId) => {
  await db.collection("sessions").deleteOne({ sessionId });
};

const auth = () => async (req, res, next) => {
  if (!req.cookies["sessionId"]) return next();

  const user = await findUserBySessionId(req.db, req.cookies["sessionId"]);
  req.user = user;
  req.sessionId = req.cookies["sessionId"];
  next();
};

module.exports = {
  hash,
  findIsActiv,
  createTimer,
  stopTimer,
  findUserByUserName,
  findUserBySessionId,
  createSession,
  deleteSession,
  auth
}

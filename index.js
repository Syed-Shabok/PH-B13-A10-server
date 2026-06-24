const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
dotenv.config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 5000;

// console.log("MONGODB_URI:", process.env.MONGODB_URI);

const uri = process.env.MONGODB_URI;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server is running.");
});

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!",
    // );
    // console.log("DB_NAME:", process.env.DB_NAME);
    const db = client.db(process.env.DB_NAME);

    const ticketsCollection = db.collection("tickets");
    const usersCollection = db.collection("user");

    // Users Related APIs

    app.get("/api/users/:email", async (req, res) => {
      const { email } = req.params;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    app.patch("/api/users/:email", async (req, res) => {
      const { email } = req.params;
      const updatedData = req.body;

      const filter = { email: email };
      const updatedDoc = {
        $set: {
          ...updatedData,
          updatedAt: new Date(),
        },
      };
      const result = await usersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // Ticket Related APIs

    app.get("/api/tickets/:email", async (req, res) => {
      const { email } = req.params;
      const result = await ticketsCollection
        .find({ vendorEmail: email })
        .toArray();
      res.send(result);
    });

    app.post("/api/tickets", async (req, res) => {
      const tickets = req.body;
      const newTickets = {
        ...tickets,
        createdAt: new Date(),
      };
      const result = await ticketsCollection.insertOne(newTickets);
      res.send(result);
    });

    app.patch("/api/tickets/:id", async (req, res) => {
      const { id } = req.params;
      const updatedTickets = req.body;

      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          ...updatedTickets,
        },
      };
      const result = await ticketsCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete("/api/tickets/:id", async (req, res) => {
      const { id } = req.params;
      const result = await ticketsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});

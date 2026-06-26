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
    const bookingsCollection = db.collection("bookings");
    const paymentsCollection = db.collection("payments");

    // Users Related APIs

    app.get("/api/users", async (req, res) => {
      try {
        const result = await usersCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch users" });
      }
    });

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

    // Update user role
    app.patch("/api/users/role/:id", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;
      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } },
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to update role" });
      }
    });

    // Mark vendor as fraud
    app.patch("/api/users/fraud/:id", async (req, res) => {
      const { id } = req.params;
      try {
        // 1. Mark user as fraud
        const vendor = await usersCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: { isBlocked: true } },
        );

        // 2. Hide/Reject all tickets from this vendor
        if (vendor && vendor.email) {
          await ticketsCollection.updateMany(
            { vendorEmail: vendor.email },
            { $set: { status: "rejected" } },
          );
        }
        res.send({
          success: true,
          message: "Vendor marked as fraud and tickets hidden.",
        });
      } catch (error) {
        res.status(500).send({ error: "Failed to mark as fraud" });
      }
    });

    // Ticket Related APIs

    // app.get("/api/tickets", async (req, res) => {
    //   const result = await ticketsCollection.find().toArray();
    //   res.send(result);
    // });

    app.get("/api/tickets/all", async (req, res) => {
      try {
        const result = await ticketsCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch all tickets" });
      }
    });

    app.get("/api/tickets", async (req, res) => {
      // Only show approved tickets
      const query = { status: "approved" };

      // Filter by "From" location
      if (req.query.from) {
        query.from = { $regex: req.query.from, $options: "i" };
      }

      // Filter by "To" location
      if (req.query.to) {
        query.to = { $regex: req.query.to, $options: "i" };
      }

      // Filter by Transport Type
      if (req.query.transportType && req.query.transportType !== "all") {
        query.transportType = {
          $regex: new RegExp(`^${req.query.transportType}$`, "i"),
        };
      }

      try {
        const result = await ticketsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch tickets" });
      }
    });

    // /api/tickets/:id    and    /api/tickets/:email were creating conflict so combined them

    app.get("/api/tickets/:identifier", async (req, res) => {
      const { identifier } = req.params;

      try {
        if (identifier.includes("@")) {
          const result = await ticketsCollection
            .find({ vendorEmail: identifier })
            .toArray();
          return res.send(result);
        }

        const query = { _id: new ObjectId(identifier) };
        const result = await ticketsCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch ticket" });
      }
    });

    // app.get("/api/tickets/:id", async (req, res) => {
    //   const { id } = req.params;

    //   const query = { _id: new ObjectId(id) };
    //   const result = await ticketsCollection.findOne(query);
    //   res.send(result);
    // });

    // app.get("/api/tickets/:email", async (req, res) => {
    //   const { email } = req.params;
    //   const result = await ticketsCollection
    //     .find({ vendorEmail: email })
    //     .toArray();
    //   res.send(result);
    // });

    // Vendor Revenue & Stats Overview
    app.get("/api/vendor/stats/:email", async (req, res) => {
      const { email } = req.params;

      try {
        // Total Tickets Added
        const totalTicketsAdded = await ticketsCollection.countDocuments({
          vendorEmail: email,
        });

        // Fetch all paid bookings for this vendor
        const paidBookings = await bookingsCollection
          .find({
            vendorEmail: email,
            paymentStatus: "paid",
          })
          .toArray();

        let totalTicketsSold = 0;
        let totalRevenue = 0;
        const revenueByTicketMap = {};

        // Aggregate totals and group data for charts
        paidBookings.forEach((booking) => {
          totalTicketsSold += booking.bookingQuantity;
          totalRevenue += booking.totalPrice;

          // Group by ticket title for the charts
          if (!revenueByTicketMap[booking.ticketTitle]) {
            revenueByTicketMap[booking.ticketTitle] = {
              name: booking.ticketTitle,
              ticketsSold: 0,
              revenue: 0,
            };
          }
          revenueByTicketMap[booking.ticketTitle].ticketsSold +=
            booking.bookingQuantity;
          revenueByTicketMap[booking.ticketTitle].revenue += booking.totalPrice;
        });

        // Convert the map into an array for Recharts
        const chartData = Object.values(revenueByTicketMap);

        res.send({
          totalTicketsAdded,
          totalTicketsSold,
          totalRevenue,
          chartData,
        });
      } catch (error) {
        console.error("Stats Error:", error);
        res.status(500).send({ error: "Failed to aggregate vendor stats" });
      }
    });

    // Toggle Advertisement Status
    app.patch("/api/tickets/:id/advertise", async (req, res) => {
      const { id } = req.params;
      const { isAdvertised } = req.body;

      try {
        // Enforce the max 6 advertised tickets limit
        if (isAdvertised) {
          const adCount = await ticketsCollection.countDocuments({
            isAdvertised: true,
          });
          if (adCount >= 6) {
            return res
              .status(400)
              .send({ message: "Maximum 6 tickets can be advertised." });
          }
        }

        const result = await ticketsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { isAdvertised } },
        );
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to update advertisement status" });
      }
    });

    app.post("/api/tickets", async (req, res) => {
      const tickets = req.body;

      // Verifty vendor is not marked as fraud
      if (tickets.vendorEmail) {
        const vendor = await usersCollection.findOne({
          email: tickets.vendorEmail,
        });

        if (vendor && vendor.isBlocked) {
          return res.status(403).send({
            error: "Account Restricted: Ticket creation denied.",
          });
        }
      }

      const newTickets = {
        ...tickets,
        createdAt: new Date(),
      };

      try {
        const result = await ticketsCollection.insertOne(newTickets);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to create ticket." });
      }
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

    // Bookings Related APIs

    app.get("/api/bookings/passenger/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const result = await bookingsCollection
          .find({ passengerEmail: email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch user bookings" });
      }
    });

    app.get("/api/bookings/vendor/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const result = await bookingsCollection
          .find({ vendorEmail: email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch vendor bookings" });
      }
    });

    // Updates booking and creates new payment
    app.post("/api/bookings/payments", async (req, res) => {
      const {
        amount,
        ticketId,
        ticketTitle,
        quantity,
        email,
        bookingId,
        paymentType,
        transactionId,
        paymentStatus,
      } = req.body;

      const parsedQuantity = parseInt(quantity);

      const paymentData = {
        ticketId,
        ticketTitle,
        passengerEmail: email,
        quantity: parsedQuantity,
        amount,
        transactionId,
        paymentType,
        paidAt: new Date(),
      };

      const isPaymentExists = await paymentsCollection.findOne({
        transactionId,
      });
      if (isPaymentExists) {
        return res.status(200).send({ message: "Already paid" });
      }

      const paymentRes = await paymentsCollection.insertOne(paymentData);

      await bookingsCollection.updateOne(
        { _id: new ObjectId(bookingId) },
        {
          $set: {
            paymentStatus: "paid",
            updatedAt: new Date(),
          },
        },
      );

      await ticketsCollection.updateOne(
        { _id: new ObjectId(ticketId) },
        { $inc: { quantity: -parsedQuantity } },
      );

      res.send(paymentRes);
    });

    app.patch("/api/bookings/:id/status", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
      try {
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: { status: status, updatedAt: new Date() },
        };
        const result = await bookingsCollection.updateOne(filter, updatedDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to update status" });
      }
    });

    app.post("/api/bookings", async (req, res) => {
      const bookingData = req.body;
      const newBooking = {
        ...bookingData,
        createdAt: new Date(),
      };
      const result = await bookingsCollection.insertOne(newBooking);
      res.send(result);
    });

    // Payments related APIs

    app.get("/api/payments/passenger/:email", async (req, res) => {
      const { email } = req.params;
      try {
        // Sort by paidAt descending (-1) to show newest transactions first
        const result = await paymentsCollection
          .find({ passengerEmail: email })
          .sort({ paidAt: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch transaction history" });
      }
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

const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
dotenv.config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server is running.");
});

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    const ticketsCollection = db.collection("tickets");
    const usersCollection = db.collection("user");
    const bookingsCollection = db.collection("bookings");
    const paymentsCollection = db.collection("payments");
    const sessionCollection = db.collection("session");

    // ==========================================
    // SECURITY MIDDLEWARES
    // ==========================================

    const verifyToken = async (req, res, next) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader) {
        return res
          .status(401)
          .send({ message: "Unauthorized access: No header" });
      }
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res
          .status(401)
          .send({ message: "Unauthorized access: No token" });
      }

      const session = await sessionCollection.findOne({ token: token });
      if (!session) {
        return res
          .status(401)
          .send({ message: "Unauthorized access: Invalid session" });
      }

      const user = await usersCollection.findOne({
        _id: new ObjectId(session.userId.toString()),
      });

      if (!user) {
        return res
          .status(401)
          .send({ message: "Unauthorized access: User not found" });
      }

      req.user = user;
      next();
    };

    const verifyAdmin = async (req, res, next) => {
      if (req.user?.role !== "admin") {
        return res
          .status(403)
          .send({ message: "Forbidden access: Admins only" });
      }
      next();
    };

    const verifyVendor = async (req, res, next) => {
      if (req.user?.role !== "vendor") {
        return res
          .status(403)
          .send({ message: "Forbidden access: Vendors only" });
      }
      next();
    };

    const verifyPassenger = async (req, res, next) => {
      if (req.user?.role !== "passenger") {
        return res
          .status(403)
          .send({ message: "Forbidden access: Passengers only" });
      }
      next();
    };

    // ==========================================
    // 1. USERS APIs
    // ==========================================

    app.get("/api/users", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await usersCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch users" });
      }
    });

    app.patch(
      "/api/users/role/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
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
      },
    );

    app.patch(
      "/api/users/fraud/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        try {
          const vendor = await usersCollection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { isBlocked: true } },
          );
          if (vendor && vendor.email) {
            await ticketsCollection.updateMany(
              { vendorEmail: vendor.email },
              { $set: { status: "rejected" } },
            );
          }
          res.send({ success: true, message: "Vendor marked as fraud." });
        } catch (error) {
          res.status(500).send({ error: "Failed to mark as fraud" });
        }
      },
    );

    app.get("/api/users/:email", verifyToken, async (req, res) => {
      const { email } = req.params;

      // DATA OWNERSHIP: Users can only see their own profile, unless they are an admin
      if (req.user.email !== email && req.user.role !== "admin") {
        return res
          .status(403)
          .send({ message: "Forbidden: Cannot view another user profile" });
      }

      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    app.patch("/api/users/:email", verifyToken, async (req, res) => {
      const { email } = req.params;

      // DATA OWNERSHIP: Users can only update their own profile
      if (req.user.email !== email) {
        return res
          .status(403)
          .send({ message: "Forbidden: Cannot modify another user profile" });
      }

      const updatedData = req.body;
      const filter = { email: email };
      const updatedDoc = {
        $set: { ...updatedData, updatedAt: new Date() },
      };
      const result = await usersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // ==========================================
    // 2. TICKETS APIs
    // ==========================================

    app.get("/api/tickets/all", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await ticketsCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch all tickets" });
      }
    });

    app.get("/api/tickets/latest", async (req, res) => {
      try {
        const result = await ticketsCollection
          .find({ status: "approved" })
          .sort({ createdAt: -1 })
          .limit(6)
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch latest tickets" });
      }
    });

    app.get("/api/tickets/advertised", async (req, res) => {
      try {
        const result = await ticketsCollection
          .find({ status: "approved", isAdvertised: true })
          .limit(6)
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch advertised tickets" });
      }
    });

    app.get("/api/tickets", async (req, res) => {
      const query = { status: "approved" };
      if (req.query.from)
        query.from = { $regex: req.query.from, $options: "i" };
      if (req.query.to) query.to = { $regex: req.query.to, $options: "i" };
      if (req.query.transportType && req.query.transportType !== "all") {
        query.transportType = {
          $regex: new RegExp(`^${req.query.transportType}$`, "i"),
        };
      }

      try {
        // Pagination logic
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 6;
        const skipItems = (page - 1) * perPage;

        // Get total count for the pagination UI
        const total = await ticketsCollection.countDocuments(query);

        // Fetch specific page chunk
        const tickets = await ticketsCollection
          .find(query)
          .skip(skipItems)
          .limit(perPage)
          .toArray();

        // Return both total and the items
        res.send({ total, tickets });
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch tickets" });
      }
    });

    app.post("/api/tickets", verifyToken, verifyVendor, async (req, res) => {
      const tickets = req.body;

      // DATA OWNERSHIP: Vendor can only create a ticket under their own email
      if (tickets.vendorEmail !== req.user.email) {
        return res.status(403).send({
          error: "Forbidden: Cannot create ticket for another vendor.",
        });
      }

      if (tickets.vendorEmail) {
        const vendor = await usersCollection.findOne({
          email: tickets.vendorEmail,
        });
        if (vendor && vendor.isBlocked) {
          return res
            .status(403)
            .send({ error: "Account Restricted: Ticket creation denied." });
        }
      }
      const newTickets = { ...tickets, createdAt: new Date() };
      try {
        const result = await ticketsCollection.insertOne(newTickets);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to create ticket." });
      }
    });

    app.patch(
      "/api/tickets/:id/advertise",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { isAdvertised } = req.body;
        try {
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
      },
    );

    app.patch("/api/tickets/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const updatedTickets = req.body;

      const ticket = await ticketsCollection.findOne({ _id: new ObjectId(id) });
      if (!ticket) {
        return res.status(404).send({ message: "Ticket not found" });
      }

      // DATA OWNERSHIP: Only the admin or the specific vendor who created the ticket can edit it
      if (req.user.role !== "admin" && ticket.vendorEmail !== req.user.email) {
        return res
          .status(403)
          .send({ message: "Forbidden: You do not own this ticket" });
      }

      const filter = { _id: new ObjectId(id) };
      const updatedDoc = { $set: { ...updatedTickets } };
      const result = await ticketsCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete("/api/tickets/:id", verifyToken, async (req, res) => {
      const { id } = req.params;

      const ticket = await ticketsCollection.findOne({ _id: new ObjectId(id) });
      if (!ticket) {
        return res.status(404).send({ message: "Ticket not found" });
      }

      // DATA OWNERSHIP: Only the admin or the specific vendor who created the ticket can delete it
      if (req.user.role !== "admin" && ticket.vendorEmail !== req.user.email) {
        return res
          .status(403)
          .send({ message: "Forbidden: You do not own this ticket" });
      }

      const result = await ticketsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

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

    // ==========================================
    // 3. VENDOR APIs
    // ==========================================

    app.get(
      "/api/vendor/stats/:email",
      verifyToken,
      verifyVendor,
      async (req, res) => {
        const { email } = req.params;

        // DATA OWNERSHIP: Ensure vendor is only looking at their own stats
        if (req.user.email !== email) {
          return res
            .status(403)
            .send({ message: "Forbidden: Unauthorized vendor data access" });
        }

        try {
          const totalTicketsAdded = await ticketsCollection.countDocuments({
            vendorEmail: email,
          });
          const paidBookings = await bookingsCollection
            .find({ vendorEmail: email, paymentStatus: "paid" })
            .toArray();
          let totalTicketsSold = 0;
          let totalRevenue = 0;
          const revenueByTicketMap = {};

          paidBookings.forEach((booking) => {
            totalTicketsSold += booking.bookingQuantity;
            totalRevenue += booking.totalPrice;
            if (!revenueByTicketMap[booking.ticketTitle]) {
              revenueByTicketMap[booking.ticketTitle] = {
                name: booking.ticketTitle,
                ticketsSold: 0,
                revenue: 0,
              };
            }
            revenueByTicketMap[booking.ticketTitle].ticketsSold +=
              booking.bookingQuantity;
            revenueByTicketMap[booking.ticketTitle].revenue +=
              booking.totalPrice;
          });

          const chartData = Object.values(revenueByTicketMap);
          res.send({
            totalTicketsAdded,
            totalTicketsSold,
            totalRevenue,
            chartData,
          });
        } catch (error) {
          res.status(500).send({ error: "Failed to aggregate vendor stats" });
        }
      },
    );

    // ==========================================
    // 4. BOOKINGS APIs
    // ==========================================

    app.get(
      "/api/bookings/passenger/:email",
      verifyToken,
      verifyPassenger,
      async (req, res) => {
        const { email } = req.params;

        // DATA OWNERSHIP
        if (req.user.email !== email) {
          return res.status(403).send({
            message: "Forbidden: Cannot access another passenger bookings",
          });
        }

        try {
          const result = await bookingsCollection
            .find({ passengerEmail: email })
            .toArray();
          res.send(result);
        } catch (error) {
          res.status(500).send({ error: "Failed to fetch user bookings" });
        }
      },
    );

    app.get(
      "/api/bookings/vendor/:email",
      verifyToken,
      verifyVendor,
      async (req, res) => {
        const { email } = req.params;

        // DATA OWNERSHIP
        if (req.user.email !== email) {
          return res.status(403).send({
            message: "Forbidden: Cannot access another vendor bookings",
          });
        }

        try {
          const result = await bookingsCollection
            .find({ vendorEmail: email })
            .toArray();
          res.send(result);
        } catch (error) {
          res.status(500).send({ error: "Failed to fetch vendor bookings" });
        }
      },
    );

    app.post(
      "/api/bookings/payments",
      verifyToken,
      verifyPassenger,
      async (req, res) => {
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

        // DATA OWNERSHIP
        if (req.user.email !== email) {
          return res.status(403).send({
            message: "Forbidden: Cannot process payment for another passenger",
          });
        }

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
        if (isPaymentExists)
          return res.status(200).send({ message: "Already paid" });

        const paymentRes = await paymentsCollection.insertOne(paymentData);
        await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          { $set: { paymentStatus: "paid", updatedAt: new Date() } },
        );
        await ticketsCollection.updateOne(
          { _id: new ObjectId(ticketId) },
          { $inc: { quantity: -parsedQuantity } },
        );

        res.send(paymentRes);
      },
    );

    app.patch(
      "/api/bookings/:id/status",
      verifyToken,
      verifyVendor,
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        // DATA OWNERSHIP: A vendor can only update the status of a booking that belongs to their tickets
        if (booking.vendorEmail !== req.user.email) {
          return res
            .status(403)
            .send({ message: "Forbidden: You cannot modify this booking" });
        }

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
      },
    );

    app.post(
      "/api/bookings",
      verifyToken,
      verifyPassenger,
      async (req, res) => {
        const bookingData = req.body;

        // DATA OWNERSHIP
        if (bookingData.passengerEmail !== req.user.email) {
          return res.status(403).send({
            message: "Forbidden: Cannot create booking for another passenger",
          });
        }

        const newBooking = { ...bookingData, createdAt: new Date() };
        const result = await bookingsCollection.insertOne(newBooking);
        res.send(result);
      },
    );

    // ==========================================
    // 5. PAYMENTS APIs
    // ==========================================

    app.get(
      "/api/payments/passenger/:email",
      verifyToken,
      verifyPassenger,
      async (req, res) => {
        const { email } = req.params;

        // DATA OWNERSHIP
        if (req.user.email !== email) {
          return res.status(403).send({
            message: "Forbidden: Cannot access another passenger payments",
          });
        }

        try {
          const result = await paymentsCollection
            .find({ passengerEmail: email })
            .sort({ paidAt: -1 })
            .toArray();
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ error: "Failed to fetch transaction history" });
        }
      },
    );
  } finally {
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});

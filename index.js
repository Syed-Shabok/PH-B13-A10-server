const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
dotenv.config();

const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server is running.");
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});

const express = require('express');
const cors = require('cors');
const port = process.env.PORT || 5000;
const app = express();
require('dotenv').config();

// middlewares
app.use(cors());
app.use(express.json());


const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.0tydy0p.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


async function run() {
  try {
    const appointmentOptionCollection = client.db("doctorsPortal").collection("appointmentOptions");
    const bookingsCollection = client.db("doctorsPortal").collection("bookings");

    // use aggregate to query multiple collection and then merge data
    app.get('/appointmentOptions', async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appointmentOptionCollection.find(query).toArray();

      // get the bookings of the provided date
      const bookingQuery = { appointmentDate: date }
      const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
      options.forEach(option => {
        const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
        const bookedSlots = optionBooked.map(book => book.slot);
        const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
        option.slots = remainingSlots;
      })
      res.send(options)
    });

    // mongodb aggregate 
    app.get('/v2/appointmentOptions', async (req, res) => {
      const date = req.query.date;
      const options = await appointmentOptionCollection.aggregate([
        {
          $lookup: 'bookings',
          localField: 'name',
          foreignField: 'treatment',
          pipeline: [{
            $match: {
              $expr: {
                $eq: ['$appointmentDate', date]
              }
            }
          }],
          as: 'booked'
        }, 
        {
          $project: {
            name: 1,
            slots: 1,
            booked: {
              $map: {
                input: '$booked', 
                as: 'book',
                in: '$book.slot'
              }
            }
          }
        },
        {
          $project: {
            name: 1,
            slots: {
              $setDifference: ['$slots', '$booked']
            }
          }
        }
      ]).toArray();
      res.send(options)
    })

    app.post('/bookings', async (req, res) => {
      const booking = req.body;
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
      }
      const alreadyBooked = await bookingsCollection.find(query).toArray();
      if(alreadyBooked.length){
        const message = `You Already have a booking on ${booking.appointmentDate}`
        return res.send({acknowledge: false, message});
      }
      const result = await bookingsCollection.insertOne(booking);
      res.send(result)
    })
  }
  finally {

  }
}
run().catch(console.log);




app.get('/', async (req, res) => {
  res.send("doctors portal server is running");
})
app.listen(port, () => {
  console.log("doctors portal running on port ", port);
})


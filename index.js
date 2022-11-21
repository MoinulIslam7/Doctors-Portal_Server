const express = require('express');
const cors = require('cors');
const port = process.env.PORT || 5000;
const app = express();
require('dotenv').config();
// jwt
const jwt = require('jsonwebtoken');



// middle wares
app.use(cors());
app.use(express.json());


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.0tydy0p.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// verify jwt 
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send('Unauthorized Access');
  }

  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'forbidden access' })
    }
    req.decoded = decoded;
    next();
  })
}

async function run() {
  try {
    const appointmentOptionCollection = client.db("doctorsPortal").collection("appointmentOptions");
    const bookingsCollection = client.db("doctorsPortal").collection("bookings");
    const usersCollection = client.db('doctorsPortal').collection('users');
    const doctorsCollection = client.db('doctorsPortal').collection('doctors');


    // middleware for verify an admin
    // NOTE: make sure verifyAdmin use after verifyJWT
    const verifyAdmin = async (req, res, next) => {
      // For only give access to see all users
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(403).send({ message: "forbidden access" })
      }
      next();
    }

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
            price: 1,
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
            price: 1,
            slots: {
              $setDifference: ['$slots', '$booked']
            }
          }
        }
      ]).toArray();
      res.send(options)
    })
    // use jwt verify
    app.get('/bookings', verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodeEmail = req.decoded.email;
      if (email !== decodeEmail) {
        return res.status(403).send({ message: 'forbidden access' });
      }

      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    })

    app.post('/bookings', async (req, res) => {
      const booking = req.body;
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
      }
      const alreadyBooked = await bookingsCollection.find(query).toArray();
      if (alreadyBooked.length) {
        const message = `You Already have a booking on ${booking.appointmentDate}`
        return res.send({ acknowledge: false, message });
      }
      const result = await bookingsCollection.insertOne(booking);
      res.send(result)
    });

    // set user
    app.post('/users', async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });


    // jwt
    app.get('/jwt', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '7d' })
        return res.send({ accessToken: token })
      }
      res.status(403).send({ accessToken: '' })

    })

    // get Users
    app.get('/users', async (req, res) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users)
    })
    // check a user is a admin or not
    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email }
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === 'admin' });
  })

    //update a use info and Make a User admin 
    app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
    
      // By clicking make admin button update user to admin
      const id = req.params.id;
      const filter = { _id: ObjectId(id) }
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updateDoc, options);
      res.send(result);
    })


    // load appointment specialty for add a doctor in specific specialty
    app.get('/appointmentSpecialty', async (req, res) =>{
      const query = {};
      const result = await appointmentOptionCollection.find(query).project({name: 1}).toArray();
      res.send(result);
    })


    // send doctor data to mongodb
    app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    })
    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) =>{
      const query = {};
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors);
    })
    app.delete('/doctors/:id', verifyJWT,verifyAdmin, async (req, res) =>{
      const id = req.params.id;
      const filter = {_id: ObjectId(id)}
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    })

    // temporary to update price field on appointment options
    // app.get('/addPrice', async (req, res) => {
    //   const filter = {};
    //   const options = {upsert: true}
    //   const updateDoc = {
    //     $set: {
    //       price: 99
    //     }
    //   }
    //   const result = await appointmentOptionCollection.updateMany(filter, updateDoc, options);
    //   res.send(result);
    // })
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


require("dotenv").config()
const Twit = require("twit")
const MongoClient = require("mongodb").MongoClient

// Setup the Twitter client
const T = new Twit({
  consumer_key:         process.env.CONSUMER_KEY,
  consumer_secret:      process.env.CONSUMER_SECRET,
  access_token:         process.env.ACCESS_TOKEN,
  access_token_secret:  process.env.ACCESS_TOKEN_SECRET
})

// My Twitter screen name (@screen_name)
const myScreenName = process.env.MY_SCREEN_NAME

// Database config
const mongoHost = process.env.MONGO_HOST
const mongoDbName = process.env.MONGO_DBNAME
const mongoPort = process.env.MONGO_PORT
const restaurantCollection = "restaurants"
const tweetCollection = "tweets"

const short_url_length_https = 23

// Let's get this party started
start()

function start() {
  // Mongo connection URI
  const mongoUri = `mongodb://${mongoHost}:${mongoPort}/${mongoDbName}`

  MongoClient.connect(mongoUri)
    .then(function(db) {
      console.log("Connected correctly to MongoDB server")

      // Graceful shutdown
      process.on("SIGINT", function () {
        console.log("Bye")
        db.close()
        process.exit()
      })

      setupStream(db)
    })
    .catch(function(err) {
      console.error("Failed to connect to Mongo", err.stack)
    })
}

function setupStream(db) {
  const stream = T.stream("user")

  stream.on("connected", function (response) {
    console.log("Connected to tweet stream")
  })
  stream.on("error", function(err) {
    console.log("Tweet stream error", err)
  })
  stream.on("disconnect", function (disconn) {
    console.log("Disconnected from tweet stream")
  })
  stream.on("reconnect", function (reconn, res, interval) {
    console.log("Reconnecting to tweet stream. statusCode:", res.statusCode)
  })

  stream.on("tweet", function (tweet) {
    // console.log(tweet)
    if (tweet.in_reply_to_screen_name == myScreenName && tweet.user.screen_name != myScreenName) {
      // They tweeted at us

      if (!allowedToGetNuggs(db, tweet.user.id)) return

      // Save the tweet in our database as an event so that we can rate limit etc.
      saveTweet(db, tweet)

      console.log(`${tweet.user.screen_name} tweeted at us: "${tweet.text}"`)
      console.log("Sending a tweet reply")

      if (tweet.coordinates != null) {
        replyWithNuggLoc(db, tweet)
      } else {
        const reply_text = `@${tweet.user.screen_name} 123Please tweet from your mobile with your precise location toggled on for that tweet (help: https://support.twitter.com/articles/122236)`
        T.post("statuses/update", { status: reply_text, in_reply_to_status_id: tweet.id_str })
          .then(function(result) {
            console.log("Reply sent with text: " + reply_text)
            console.log("")
          })
          .catch(function(err) {
            console.error("Failed to reply", err.stack)
          })
      }

    }
  })
}

function allowedToGetNuggs(db, twitterUserId) {
  // TODO: Apply some form of rate limitting or something
  return true
}

function saveTweet(db, tweet) {
  // Add my own timestamp so I don't have to parse Twitter's silly format (and it's easier)
  tweet["custom_created_at"] = new Date()
  db.collection(tweetCollection).insertOne(tweet)
    .catch(function(err) {
      console.log("Error saving tweet", err.stack)
    })
}

function trimTweetText(unknownLengthString, knownAppendingStringLength) {
  if (unknownLengthString.length > 140 - knownAppendingStringLength) {
    unknownLengthString = unknownLengthString.substring(0, 140 - knownAppendingStringLength - 3) + "..."
  }
  return unknownLengthString
}

function getNearestNuggets(db, originalTweet, cb) {
  // Note that in GeoJSON it's longitude THEN latitude
  const coords = originalTweet.coordinates.coordinates
  const latlng = [coords[1], coords[0]]
  console.log("Coords: " + latlng)

  const collection = db.collection(restaurantCollection)

  // Make sure the loc column is indexed and of index type 2dsphere
  collection.ensureIndex({loc:"2dsphere"})
    .then(function(result) {
      collection.geoNear(latlng[1], latlng[0], {query: {has_nuggs: true}, num: 1, spherical: true})
        .then(function(docs) {
          // console.log(docs.results[0])
          if (docs.results.length > 0) {
            cb(docs.results[0].obj)
          } else {
            cb(null)
          }
        })
        .catch(function(err) {
          console.error("Error in geoNear mongo query", err.stack)
          cb(null)
        })
    })
    .catch(function(err) {
      console.error("Ensuring index 2dsphere for location failed", err.stack)
    })
}

function replyWithNuggLoc(db, originalTweet) {
  getNearestNuggets(db, originalTweet, function(nearestNugg) {
    let replyText = ""
    if (nearestNugg == null) {
      replyText = "Sorry, but there was an error getting your nearest place of nuggets."
    } else {
      const mapUrl = "https://www.google.co.uk/maps/search/" + encodeURIComponent(nearestNugg.loc[1].toString() + "," + nearestNugg.loc[0].toString())
      const unknownLengthString = trimTweetText(`@${originalTweet.user.screen_name} ${nearestNugg.name} - ${nearestNugg.address}`, short_url_length_https + 1)
      replyText = `${unknownLengthString} ${mapUrl}`
    }

    T.post("statuses/update", { status: replyText, in_reply_to_status_id: originalTweet.id_str })
      .then(function(result) {
        // console.log(result["data"])
        console.log("Reply sent with text: " + replyText)
        console.log("")
      })
      .catch(function(err) {
        console.error("Failed to reply", err.stack)
      })
  })
}

// Get the Twitter short url lengths
// T.get("help/configuration", function(err, data, response) {
//   console.log(data)
// })

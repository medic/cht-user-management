const express = require('express');

const app = express();

// Middleware function to set timeout for all POST requests
const timeoutMiddleware = (req, res, next) => {
  // Set timeout duration (in milliseconds)
  const TIMEOUT_DURATION = 5000; // 5 seconds

  // Set timeout for this request
  req.setTimeout(TIMEOUT_DURATION, () => {
    // Handle timeout
    res.status(408).send('Request Timeout');
  });

  // Continue to next middleware
  next();
};

// Apply timeout middleware for all routes
app.use(timeoutMiddleware);

// Route for handling POST requests
app.all('*', (req, res) => {
  // Simulate long processing time to trigger timeout
  setTimeout(() => {
    res.send('POST request handled successfully');
  }, 6000); // This will exceed the timeout and trigger a timeout response
});

// Start the server
app.listen(3556, () => {
  console.log(`Server is listening on port ${3556}`);
});

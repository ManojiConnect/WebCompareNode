const express = require('express');
const path = require('path');
const { comparePages } = require('./src/services/comparisonService');

const app = express();
const port = process.env.PORT || 3000;

// Increase payload size limit for large responses
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files with caching
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '1h',
    etag: true
}));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Request logging middleware with error handling
app.use((req, res, next) => {
    try {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
        if (req.method === 'POST') {
            console.log('Request body:', JSON.stringify(req.body, null, 2));
        }
        next();
    } catch (error) {
        console.error('Error in logging middleware:', error);
        next();
    }
});

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

// Add health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.post('/compare', async (req, res) => {
    try {
        console.log('Received comparison request:', {
            originalUrl: req.body.originalUrl,
            upgradedUrl: req.body.upgradedUrl
        });

        if (!req.body.originalUrl || !req.body.upgradedUrl) {
            return res.status(400).json({
                error: 'Both URLs are required',
                details: 'Please provide both original and upgraded URLs'
            });
        }

        // Validate URLs
        try {
            new URL(req.body.originalUrl);
            new URL(req.body.upgradedUrl);
        } catch (error) {
            return res.status(400).json({
                error: 'Invalid URL format',
                details: 'Please provide valid URLs starting with http:// or https://'
            });
        }

        console.log('Starting comparison process...');
        const result = await comparePages(req.body.originalUrl, req.body.upgradedUrl);
        console.log('Comparison completed successfully:', {
            misMatchPercentage: result.misMatchPercentage,
            diffImageUrl: result.diffImageUrl,
            originalImageUrl: result.originalImageUrl,
            upgradedImageUrl: result.upgradedImageUrl
        });
        
        res.json(result);
    } catch (error) {
        console.error('Error in /compare endpoint:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        // Send more detailed error response
        res.status(500).json({
            error: error.message || 'An error occurred while comparing pages',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', {
        message: err.message,
        stack: err.stack,
        name: err.name
    });
    
    res.status(500).json({
        error: 'An unexpected error occurred',
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Function to start server with port retry and error handling
function startServer(port) {
    const server = app.listen(port)
        .on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${port} is busy, trying ${port + 1}...`);
                startServer(port + 1);
            } else {
                console.error('Server error:', err);
            }
        })
        .on('listening', () => {
            const actualPort = server.address().port;
            console.log(`Server is running on http://localhost:${actualPort}`);
            console.log('Environment:', process.env.NODE_ENV || 'development');
        });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
        console.error('Uncaught Exception:', err);
        // Don't crash the server
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        // Don't crash the server
    });

    return server;
}

// Start server
const server = startServer(port);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
}); 
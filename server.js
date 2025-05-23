const express = require('express');
const path = require('path');
const { comparePages } = require('./src/services/comparisonService');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    if (req.method === 'POST') {
        console.log('Request body:', JSON.stringify(req.body, null, 2));
    }
    next();
});

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.post('/compare', async (req, res) => {
    try {
        console.log('Received comparison request:', {
            originalUrl: req.body.originalUrl,
            upgradedUrl: req.body.upgradedUrl
        });

        if (!req.body.originalUrl || !req.body.upgradedUrl) {
            throw new Error('Both URLs are required');
        }

        // Validate URLs
        try {
            new URL(req.body.originalUrl);
            new URL(req.body.upgradedUrl);
        } catch (error) {
            throw new Error('Invalid URL format');
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

// Start server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log('Environment:', process.env.NODE_ENV || 'development');
}); 
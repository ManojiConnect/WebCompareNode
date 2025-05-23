const express = require('express');
const path = require('path');
const multer = require('multer');
const { comparePages } = require('./services/comparisonService');

const app = express();
const port = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('uploads'));

// Parse JSON bodies
app.use(express.json());

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.post('/compare', upload.fields([
    { name: 'originalUrl', maxCount: 1 },
    { name: 'upgradedUrl', maxCount: 1 }
]), async (req, res) => {
    try {
        const { originalUrl, upgradedUrl } = req.body;
        
        if (!originalUrl || !upgradedUrl) {
            return res.status(400).json({ error: 'Both URLs are required' });
        }

        const result = await comparePages(originalUrl, upgradedUrl);
        res.json(result);
    } catch (error) {
        console.error('Comparison error:', error);
        res.status(500).json({ error: 'Failed to compare pages' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 
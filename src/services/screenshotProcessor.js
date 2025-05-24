const fs = require('fs').promises;
const path = require('path');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

const SCREENSHOTS_DIR = path.join(__dirname, '../../uploads/screenshots');
const MAX_DIMENSION = 5000;

function resizeImage(image, maxDimension) {
    if (image.width <= maxDimension && image.height <= maxDimension) {
        return image;
    }

    const scale = Math.min(maxDimension / image.width, maxDimension / image.height);
    const newWidth = Math.floor(image.width * scale);
    const newHeight = Math.floor(image.height * scale);

    const resized = new PNG({ width: newWidth, height: newHeight });
    
    // Simple nearest-neighbor scaling
    for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
            const srcX = Math.floor(x / scale);
            const srcY = Math.floor(y / scale);
            const srcIdx = (srcY * image.width + srcX) * 4;
            const dstIdx = (y * newWidth + x) * 4;

            resized.data[dstIdx] = image.data[srcIdx];
            resized.data[dstIdx + 1] = image.data[srcIdx + 1];
            resized.data[dstIdx + 2] = image.data[srcIdx + 2];
            resized.data[dstIdx + 3] = image.data[srcIdx + 3];
        }
    }

    return resized;
}

async function processScreenshots(originalScreenshot, upgradedScreenshot) {
    try {
        // Check file sizes before reading
        const originalStats = await fs.stat(originalScreenshot);
        const upgradedStats = await fs.stat(upgradedScreenshot);
        
        console.error('File sizes:', {
            original: originalStats.size,
            upgraded: upgradedStats.size
        });

        // Set a reasonable size limit (e.g., 10MB)
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        if (originalStats.size > MAX_FILE_SIZE || upgradedStats.size > MAX_FILE_SIZE) {
            throw new Error(`Screenshot files too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
        }

        // Read and parse files directly
        console.error('Reading original image...');
        let originalBuffer = await fs.readFile(originalScreenshot);
        console.error('Original image read, size:', originalBuffer.length);
        
        // Parse original image
        console.error('Parsing original image...');
        let img1 = PNG.sync.read(originalBuffer);
        console.error('Original image parsed:', {
            width: img1.width,
            height: img1.height
        });
        
        // Clear original buffer
        originalBuffer = null;

        console.error('Reading upgraded image...');
        let upgradedBuffer = await fs.readFile(upgradedScreenshot);
        console.error('Upgraded image read, size:', upgradedBuffer.length);
        
        // Parse upgraded image
        console.error('Parsing upgraded image...');
        let img2 = PNG.sync.read(upgradedBuffer);
        console.error('Upgraded image parsed:', {
            width: img2.width,
            height: img2.height
        });
        
        // Clear upgraded buffer
        upgradedBuffer = null;

        // Resize images if they're too large
        console.error('Checking image dimensions...');
        if (img1.width > MAX_DIMENSION || img1.height > MAX_DIMENSION) {
            console.error('Resizing original image...');
            img1 = resizeImage(img1, MAX_DIMENSION);
            console.error('Original image resized to:', { width: img1.width, height: img1.height });
        }

        if (img2.width > MAX_DIMENSION || img2.height > MAX_DIMENSION) {
            console.error('Resizing upgraded image...');
            img2 = resizeImage(img2, MAX_DIMENSION);
            console.error('Upgraded image resized to:', { width: img2.width, height: img2.height });
        }

        // Ensure both images have the same dimensions
        const width = Math.max(img1.width, img2.width);
        const height = Math.max(img1.height, img2.height);

        console.error('Creating comparison images...');
        // Create new PNG instances with the same dimensions
        const resizedImg1 = new PNG({ width, height });
        const resizedImg2 = new PNG({ width, height });
        const diffImage = new PNG({ width, height });

        // Process images in smaller chunks to manage memory
        const CHUNK_SIZE = 25; // Process 25 rows at a time
        let totalDiffPixels = 0;

        for (let y = 0; y < height; y += CHUNK_SIZE) {
            const endY = Math.min(y + CHUNK_SIZE, height);
            console.error(`Processing rows ${y} to ${endY}...`);

            // Process each chunk
            for (let row = y; row < endY; row++) {
                for (let x = 0; x < width; x++) {
                    const idx = (row * width + x) * 4;
                    
                    // Copy from original image if within bounds
                    if (x < img1.width && row < img1.height) {
                        const origIdx = (row * img1.width + x) * 4;
                        resizedImg1.data[idx] = img1.data[origIdx];
                        resizedImg1.data[idx + 1] = img1.data[origIdx + 1];
                        resizedImg1.data[idx + 2] = img1.data[origIdx + 2];
                        resizedImg1.data[idx + 3] = img1.data[origIdx + 3];
                    }

                    // Copy from upgraded image if within bounds
                    if (x < img2.width && row < img2.height) {
                        const origIdx = (row * img2.width + x) * 4;
                        resizedImg2.data[idx] = img2.data[origIdx];
                        resizedImg2.data[idx + 1] = img2.data[origIdx + 1];
                        resizedImg2.data[idx + 2] = img2.data[origIdx + 2];
                        resizedImg2.data[idx + 3] = img2.data[origIdx + 3];
                    }
                }
            }

            // Compare this chunk
            const chunkHeight = endY - y;
            const numDiffPixels = pixelmatch(
                resizedImg1.data.slice(y * width * 4, endY * width * 4),
                resizedImg2.data.slice(y * width * 4, endY * width * 4),
                diffImage.data.slice(y * width * 4, endY * width * 4),
                width,
                chunkHeight,
                {
                    threshold: 0.2,
                    includeAA: true,
                    alpha: 0.5,
                    diffColor: [255, 0, 0],
                    diffColorAlt: [0, 0, 255]
                }
            );

            totalDiffPixels += numDiffPixels;
            console.error(`Processed chunk ${y / CHUNK_SIZE + 1}/${Math.ceil(height / CHUNK_SIZE)}`);
        }

        // Calculate difference percentage
        const totalPixels = width * height;
        const diffPercentage = (totalDiffPixels / totalPixels) * 100;

        // Clear original images to free memory
        img1 = null;
        img2 = null;

        console.error('Saving diff image...');
        // Save the diff image
        const diffPath = path.join(SCREENSHOTS_DIR, 'diff.png');
        await fs.writeFile(diffPath, PNG.sync.write(diffImage));

        // Clear comparison images to free memory
        resizedImg1.data = null;
        resizedImg2.data = null;
        diffImage.data = null;

        console.error('Comparison completed successfully');
        return {
            misMatchPercentage: diffPercentage,
            diffImageUrl: '/uploads/screenshots/diff.png',
            originalImageUrl: '/uploads/screenshots/original.png',
            upgradedImageUrl: '/uploads/screenshots/upgraded.png'
        };
    } catch (error) {
        console.error('Error processing screenshots:', error);
        throw error;
    }
}

// Get command line arguments
const [,, originalScreenshot, upgradedScreenshot] = process.argv;

if (!originalScreenshot || !upgradedScreenshot) {
    console.error('Usage: node screenshotProcessor.js <original-screenshot> <upgraded-screenshot>');
    process.exit(1);
}

// Process screenshots and output result as JSON
processScreenshots(originalScreenshot, upgradedScreenshot)
    .then(result => {
        try {
            // Output the result directly to stdout
            process.stdout.write(JSON.stringify(result) + '\n', () => {
                process.exit(0);
            });
        } catch (error) {
            console.error('Error writing result:', error);
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });

// Handle any uncaught errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error.message);
    process.exit(1);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error.message);
    process.exit(1);
}); 
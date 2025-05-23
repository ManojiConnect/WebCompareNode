const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');
const diffLib = require('diff');
const https = require('https');
const http = require('http');

const SCREENSHOTS_DIR = path.join(__dirname, '../../uploads/screenshots');

async function clearOldFiles() {
    try {
        const files = await fs.readdir(SCREENSHOTS_DIR);
        await Promise.all(files.map(file => 
            fs.unlink(path.join(SCREENSHOTS_DIR, file))
        ));
    } catch (error) {
        console.error('Error clearing old files:', error);
        // Don't throw here, as this is not critical
    }
}

async function getResourceContent(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const timeout = setTimeout(() => {
            reject(new Error(`Timeout fetching resource: ${url}`));
        }, 10000); // 10 second timeout

        client.get(url, (res) => {
            clearTimeout(timeout);
            if (res.statusCode !== 200) {
                resolve(null); // Don't reject, just skip this resource
                return;
            }

            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve(data);
            });
        }).on('error', (error) => {
            clearTimeout(timeout);
            console.error(`Error fetching resource ${url}:`, error);
            resolve(null); // Don't reject, just skip this resource
        });
    });
}

async function analyzeResources(page) {
    try {
        console.log('Starting resource analysis...');
        const resources = {
            css: [],
            javascript: [],
            images: []
        };

        // Get all resources with a timeout
        const resourceUrls = await Promise.race([
            page.evaluate(() => {
                const resources = [];
                // Get CSS files
                document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
                    if (link.href) resources.push({ type: 'css', url: link.href });
                });
                // Get JavaScript files
                document.querySelectorAll('script[src]').forEach(script => {
                    if (script.src) resources.push({ type: 'javascript', url: script.src });
                });
                // Get images
                document.querySelectorAll('img[src]').forEach(img => {
                    if (img.src) resources.push({ type: 'image', url: img.src });
                });
                return resources;
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Resource analysis timeout')), 30000)
            )
        ]);

        console.log(`Found ${resourceUrls.length} resources to analyze`);

        // Process resources in batches to prevent memory issues
        const batchSize = 10;
        for (let i = 0; i < resourceUrls.length; i += batchSize) {
            const batch = resourceUrls.slice(i, i + batchSize);
            await Promise.all(batch.map(async (resource) => {
                try {
                    if (resource.type === 'css' || resource.type === 'javascript') {
                        const content = await getResourceContent(resource.url);
                        if (content) {
                            resources[resource.type].push({
                                url: resource.url,
                                content
                            });
                        }
                    } else if (resource.type === 'image') {
                        resources.images.push({
                            url: resource.url
                        });
                    }
                } catch (error) {
                    console.error(`Error processing resource ${resource.url}:`, error);
                }
            }));
        }

        console.log('Resource analysis completed');
        return resources;
    } catch (error) {
        console.error('Error analyzing resources:', error);
        return {
            css: [],
            javascript: [],
            images: []
        };
    }
}

async function compareResources(originalResources, upgradedResources) {
    try {
        console.log('Starting resource comparison...');
        const differences = {
            css: [],
            javascript: [],
            images: {
                added: [],
                removed: []
            }
        };

        // Compare CSS files
        for (const originalCss of originalResources.css) {
            const upgradedCss = upgradedResources.css.find(css => css.url === originalCss.url);
            if (upgradedCss) {
                const cssDiff = diffLib.createPatch(
                    originalCss.url,
                    originalCss.content,
                    upgradedCss.content,
                    'Original',
                    'Upgraded'
                );
                if (cssDiff.length > 0) {
                    differences.css.push({
                        url: originalCss.url,
                        diff: cssDiff
                    });
                }
            }
        }

        // Compare JavaScript files
        for (const originalJs of originalResources.javascript) {
            const upgradedJs = upgradedResources.javascript.find(js => js.url === originalJs.url);
            if (upgradedJs) {
                const jsDiff = diffLib.createPatch(
                    originalJs.url,
                    originalJs.content,
                    upgradedJs.content,
                    'Original',
                    'Upgraded'
                );
                if (jsDiff.length > 0) {
                    differences.javascript.push({
                        url: originalJs.url,
                        diff: jsDiff
                    });
                }
            }
        }

        // Compare images
        const originalImageUrls = new Set(originalResources.images.map(img => img.url));
        const upgradedImageUrls = new Set(upgradedResources.images.map(img => img.url));

        // Find added and removed images
        for (const url of upgradedImageUrls) {
            if (!originalImageUrls.has(url)) {
                differences.images.added.push(url);
            }
        }
        for (const url of originalImageUrls) {
            if (!upgradedImageUrls.has(url)) {
                differences.images.removed.push(url);
            }
        }

        console.log('Resource comparison completed');
        return differences;
    } catch (error) {
        console.error('Error comparing resources:', error);
        return {
            css: [],
            javascript: [],
            images: {
                added: [],
                removed: []
            }
        };
    }
}

async function takeScreenshot(url, filename) {
    let browser;
    try {
        console.log(`Taking screenshot of ${url}`);
        try {
            browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
            });
        } catch (launchError) {
            console.error('Failed to launch browser:', launchError);
            throw new Error(`Failed to launch browser: ${launchError.message}`);
        }

        const page = await browser.newPage();
        
        // Set a fixed viewport size
        await page.setViewport({ 
            width: 1920, 
            height: 1080,
            deviceScaleFactor: 1
        });
        
        console.log(`Navigating to ${url}`);
        try {
            // Set a timeout for page load
            await page.goto(url, { 
                waitUntil: 'networkidle0',
                timeout: 30000 // 30 seconds timeout
            });

            // Wait for any dynamic content to load
            await page.waitForTimeout(2000);

            // Get the page dimensions
            const dimensions = await page.evaluate(() => {
                return {
                    width: Math.max(
                        document.documentElement.clientWidth,
                        document.body.scrollWidth,
                        document.documentElement.scrollWidth
                    ),
                    height: Math.max(
                        document.documentElement.clientHeight,
                        document.body.scrollHeight,
                        document.documentElement.scrollHeight
                    )
                };
            });

            // Set viewport to match page dimensions
            await page.setViewport({
                width: dimensions.width,
                height: dimensions.height,
                deviceScaleFactor: 1
            });

        } catch (navigationError) {
            console.error(`Failed to navigate to ${url}:`, navigationError);
            throw new Error(`Failed to load page: ${navigationError.message}`);
        }
        
        console.log('Page loaded, analyzing resources...');
        // Get HTML content and resources
        const html = await page.content();
        const resources = await analyzeResources(page);
        
        // Ensure screenshots directory exists
        try {
            await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
        } catch (mkdirError) {
            console.error('Failed to create screenshots directory:', mkdirError);
            throw new Error(`Failed to create screenshots directory: ${mkdirError.message}`);
        }
        
        const screenshotPath = path.join(SCREENSHOTS_DIR, filename);
        console.log(`Taking screenshot and saving to ${screenshotPath}`);
        try {
            await page.screenshot({ 
                path: screenshotPath,
                fullPage: true,
                omitBackground: true // This helps with consistent comparison
            });
        } catch (screenshotError) {
            console.error('Failed to take screenshot:', screenshotError);
            throw new Error(`Failed to capture screenshot: ${screenshotError.message}`);
        }

        console.log('Screenshot completed successfully');
        return { screenshotPath, html, resources };
    } catch (error) {
        console.error(`Error taking screenshot of ${url}:`, error);
        throw new Error(`Failed to process page: ${error.message}`);
    } finally {
        if (browser) {
            try {
                console.log('Closing browser');
                await browser.close();
            } catch (closeError) {
                console.error('Error closing browser:', closeError);
            }
        }
    }
}

async function comparePages(originalUrl, upgradedUrl) {
    try {
        console.log('Starting page comparison...');
        if (!originalUrl || !upgradedUrl) {
            throw new Error('Both URLs are required for comparison');
        }

        // Clear old files first
        await clearOldFiles();

        // Take screenshots and get HTML content
        console.log('Taking screenshot of original page...');
        const { screenshotPath: originalScreenshot, html: originalHtml, resources: originalResources } = 
            await takeScreenshot(originalUrl, 'original.png');
        
        console.log('Taking screenshot of upgraded page...');
        const { screenshotPath: upgradedScreenshot, html: upgradedHtml, resources: upgradedResources } = 
            await takeScreenshot(upgradedUrl, 'upgraded.png');

        console.log('Comparing HTML content...');
        // Compare HTML
        const htmlDiff = diffLib.createPatch(
            'comparison',
            originalHtml,
            upgradedHtml,
            'Original',
            'Upgraded'
        );

        console.log('Comparing resources...');
        // Compare resources
        const resourceDiffs = await compareResources(originalResources, upgradedResources);

        console.log('Saving comparison results...');
        // Save HTML diff to file
        const htmlDiffPath = path.join(SCREENSHOTS_DIR, 'diff.html');
        await fs.writeFile(htmlDiffPath, htmlDiff);

        // Save resource diffs
        const resourceDiffPath = path.join(SCREENSHOTS_DIR, 'resource-diffs.json');
        await fs.writeFile(resourceDiffPath, JSON.stringify(resourceDiffs, null, 2));

        console.log('Reading PNG files for visual comparison...');
        // Read the PNG files
        const img1 = PNG.sync.read(await fs.readFile(originalScreenshot));
        const img2 = PNG.sync.read(await fs.readFile(upgradedScreenshot));
        
        // Ensure both images have the same dimensions
        const width = Math.max(img1.width, img2.width);
        const height = Math.max(img1.height, img2.height);

        // Create new PNG instances with the same dimensions
        const resizedImg1 = new PNG({ width, height });
        const resizedImg2 = new PNG({ width, height });
        const diffImage = new PNG({ width, height });

        // Copy original images to resized canvases
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                if (x < img1.width && y < img1.height) {
                    const origIdx = (y * img1.width + x) * 4;
                    resizedImg1.data[idx] = img1.data[origIdx];
                    resizedImg1.data[idx + 1] = img1.data[origIdx + 1];
                    resizedImg1.data[idx + 2] = img1.data[origIdx + 2];
                    resizedImg1.data[idx + 3] = img1.data[origIdx + 3];
                }
                if (x < img2.width && y < img2.height) {
                    const origIdx = (y * img2.width + x) * 4;
                    resizedImg2.data[idx] = img2.data[origIdx];
                    resizedImg2.data[idx + 1] = img2.data[origIdx + 1];
                    resizedImg2.data[idx + 2] = img2.data[origIdx + 2];
                    resizedImg2.data[idx + 3] = img2.data[origIdx + 3];
                }
            }
        }

        console.log('Performing pixel comparison...');
        // Compare images
        const numDiffPixels = pixelmatch(
            resizedImg1.data,
            resizedImg2.data,
            diffImage.data,
            width,
            height,
            {
                threshold: 0.1,
                includeAA: true
            }
        );

        // Calculate difference percentage
        const totalPixels = width * height;
        const diffPercentage = (numDiffPixels / totalPixels) * 100;

        console.log('Saving diff image...');
        // Save the diff image
        const diffPath = path.join(SCREENSHOTS_DIR, 'diff.png');
        await fs.writeFile(diffPath, PNG.sync.write(diffImage));

        console.log('Comparison completed successfully');
        return {
            misMatchPercentage: diffPercentage,
            diffImageUrl: '/uploads/screenshots/diff.png',
            originalImageUrl: '/uploads/screenshots/original.png',
            upgradedImageUrl: '/uploads/screenshots/upgraded.png',
            htmlDiffUrl: '/uploads/screenshots/diff.html',
            resourceDiffsUrl: '/uploads/screenshots/resource-diffs.json'
        };
    } catch (error) {
        console.error('Error in comparison:', error);
        throw new Error(`Comparison failed: ${error.message}`);
    }
}

module.exports = {
    comparePages
}; 
const puppeteer = require('puppeteer');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');
const diffLib = require('diff');
const https = require('https');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const SCREENSHOTS_DIR = path.join(__dirname, '../../uploads/screenshots');

async function clearOldFiles() {
    try {
        const files = await fsPromises.readdir(SCREENSHOTS_DIR);
        await Promise.all(files.map(file => 
            fsPromises.unlink(path.join(SCREENSHOTS_DIR, file))
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

        // Extract path after domain for image comparison
        function getImagePath(url) {
            try {
                const urlObj = new URL(url);
                return urlObj.pathname;
            } catch (e) {
                return url; // If not a valid URL, return as is
            }
        }
        
        // Create maps of image paths to full URLs
        const originalImagePathMap = new Map();
        const upgradedImagePathMap = new Map();
        
        // Process original images
        originalResources.images.forEach(img => {
            const path = getImagePath(img.url);
            originalImagePathMap.set(path, img.url);
            console.log(`Original image: ${img.url} -> Path: ${path}`);
        });
        
        // Process upgraded images
        upgradedResources.images.forEach(img => {
            const path = getImagePath(img.url);
            upgradedImagePathMap.set(path, img.url);
            console.log(`Upgraded image: ${img.url} -> Path: ${path}`);
        });
        
        console.log(`Found ${originalImagePathMap.size} original images and ${upgradedImagePathMap.size} upgraded images`);
        
        // Find added images (in upgraded but not in original)
        for (const [path, url] of upgradedImagePathMap.entries()) {
            if (!originalImagePathMap.has(path)) {
                console.log(`Added image: ${url} (Path: ${path})`);
                differences.images.added.push(url);
            }
        }
        
        // Find removed images (in original but not in upgraded)
        for (const [path, url] of originalImagePathMap.entries()) {
            if (!upgradedImagePathMap.has(path)) {
                console.log(`Removed image: ${url} (Path: ${path})`);
                differences.images.removed.push(url);
            }
        }
        
        console.log(`Found ${differences.images.added.length} added images and ${differences.images.removed.length} removed images`);

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
    let page;
    try {
        console.log(`Taking screenshot of ${url}`);
            browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                '--disable-web-security',
                    '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-extensions',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials'
                ],
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            timeout: 60000 // Increase browser launch timeout
            });

        page = await browser.newPage();
        
        // Set a fixed viewport size with maximum dimensions
        await page.setViewport({ 
            width: 1920, 
            height: 1080,
            deviceScaleFactor: 1
        });

        // Set longer timeouts
        page.setDefaultNavigationTimeout(60000); // Increase to 60 seconds
        page.setDefaultTimeout(60000);

        // Enable request logging
        page.on('request', request => {
            console.log(`Request: ${request.method()} ${request.url()}`);
        });

        page.on('requestfailed', request => {
            console.error(`Request failed: ${request.url()} - ${request.failure().errorText}`);
        });

        page.on('console', msg => {
            console.log(`Page console: ${msg.text()}`);
        });
        
        console.log(`Navigating to ${url}`);
        try {
            // Try multiple navigation strategies
            const response = await page.goto(url, { 
                waitUntil: ['domcontentloaded', 'networkidle0'],
                timeout: 60000
            });

            if (!response) {
                throw new Error('No response received from page');
            }

            console.log(`Page response status: ${response.status()} ${response.statusText()}`);

            if (!response.ok()) {
                throw new Error(`Page returned status code ${response.status()} (${response.statusText()})`);
            }

            // Wait for any dynamic content to load
            await page.waitForTimeout(5000);

            // Get the page dimensions with a maximum limit
            const dimensions = await page.evaluate(() => {
                try {
                return {
                        width: Math.min(
                            Math.max(
                                document.documentElement.clientWidth || 0,
                                document.body.scrollWidth || 0,
                                document.documentElement.scrollWidth || 0,
                                1920
                            ),
                            5000
                        ),
                        height: Math.min(
                            Math.max(
                                document.documentElement.clientHeight || 0,
                                document.body.scrollHeight || 0,
                                document.documentElement.scrollHeight || 0,
                                1080
                            ),
                            5000
                        )
                    };
                } catch (error) {
                    console.error('Error getting dimensions:', error);
                    return { width: 1920, height: 1080 };
                }
            });

            console.log('Page dimensions:', dimensions);

            // Set viewport to match page dimensions
            await page.setViewport({
                width: dimensions.width,
                height: dimensions.height,
                deviceScaleFactor: 1
            });
        
        console.log('Page loaded, analyzing resources...');
        const html = await page.content();
        const resources = await analyzeResources(page);
        
        // Ensure screenshots directory exists
        try {
                await fsPromises.mkdir(SCREENSHOTS_DIR, { recursive: true });
                console.log('Screenshots directory verified:', SCREENSHOTS_DIR);
        } catch (mkdirError) {
            console.error('Failed to create screenshots directory:', mkdirError);
            throw new Error(`Failed to create screenshots directory: ${mkdirError.message}`);
        }
        
        const screenshotPath = path.join(SCREENSHOTS_DIR, filename);
        console.log(`Taking screenshot and saving to ${screenshotPath}`);
            
            await page.screenshot({ 
                path: screenshotPath,
                fullPage: true,
                omitBackground: true
            });

            // Verify the screenshot was created
            try {
                const stats = await fsPromises.stat(screenshotPath);
                console.log('Screenshot saved successfully:', {
                    path: screenshotPath,
                    size: stats.size,
                    created: stats.birthtime
                });
            } catch (error) {
                console.error('Failed to verify screenshot:', error);
                throw new Error('Screenshot file not found after capture');
        }

        console.log('Screenshot completed successfully');
        return { screenshotPath, html, resources };
        } catch (navigationError) {
            console.error(`Failed to navigate to ${url}:`, navigationError);
            throw new Error(`Failed to load page: ${navigationError.message}`);
        }
    } catch (error) {
        console.error(`Error taking screenshot of ${url}:`, error);
        throw new Error(`Failed to process page: ${error.message}`);
    } finally {
        if (page) {
            try {
                console.log('Closing page');
                await page.close();
            } catch (closeError) {
                console.error('Error closing page:', closeError);
            }
        }
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

async function processScreenshots(originalScreenshot, upgradedScreenshot) {
    let processor = null;

    try {
        processor = spawn('node', [
            path.join(__dirname, 'screenshotProcessor.js'),
            originalScreenshot,
            upgradedScreenshot
        ]);

        const result = await new Promise((resolve, reject) => {
            let output = '';
            let error = '';

            processor.stdout.on('data', (data) => {
                output += data.toString();
            });

            processor.stderr.on('data', (data) => {
                const message = data.toString();
                console.log('Processor:', message);
                error += message;
            });

            processor.on('error', (err) => {
                reject(new Error(`Failed to start processor: ${err.message}`));
            });

            processor.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(output.trim());
                        resolve(result);
                    } catch (e) {
                        reject(new Error(`Failed to parse processor output: ${e.message}`));
                    }
                } else {
                    reject(new Error(`Processor failed with code ${code}: ${error}`));
                }
            });
        });

        return result;
    } catch (error) {
        throw error;
    } finally {
        // Ensure the processor is killed
        if (processor) {
            try {
                processor.kill();
            } catch (error) {
                console.error('Error killing processor:', error);
            }
        }
    }
}

async function comparePages(originalUrl, upgradedUrl) {
    let browser = null;
    try {
        // Take screenshots
        const originalResult = await takeScreenshot(originalUrl, 'original.png');
        const upgradedResult = await takeScreenshot(upgradedUrl, 'upgraded.png');

        if (!originalResult || !originalResult.screenshotPath || !upgradedResult || !upgradedResult.screenshotPath) {
            throw new Error('Failed to capture screenshots');
        }

        // Process screenshots in separate process
        const comparisonResult = await processScreenshots(originalResult.screenshotPath, upgradedResult.screenshotPath);
        
        // Compare resources and get differences
        const resourceDiffs = await compareResources(originalResult.resources, upgradedResult.resources);
        
        // Return the comparison result
        return {
            ...comparisonResult,
            html: {
                original: originalResult.html,
                upgraded: upgradedResult.html
            },
            resources: resourceDiffs
        };
    } catch (error) {
        console.error('Error comparing pages:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = {
    comparePages
}; 
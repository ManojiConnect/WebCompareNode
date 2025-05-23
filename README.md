# Web Page Comparison Tool

A Node.js application that compares two web pages and shows their differences in terms of:
- Visual appearance (screenshots)
- HTML structure
- CSS files
- JavaScript files
- Images

## Features

- Takes screenshots of both pages
- Highlights visual differences
- Shows HTML structure differences
- Compares external resources (CSS, JavaScript, images)
- Provides a user-friendly web interface
- Supports both HTTP and HTTPS URLs

## Prerequisites

- Node.js (v14 or higher)
- Google Chrome (for Puppeteer)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/ManojiConnect/WebCompareNode.git
cd WebCompareNode
```

2. Install dependencies:
```bash
npm install
```

3. Create required directories:
```bash
mkdir -p uploads/screenshots
```

## Usage

1. Start the server:
```bash
node server.js
```

2. Open your browser and navigate to:
```
http://localhost:3000
```

3. Enter the URLs of the two pages you want to compare
4. Click "Compare Pages" to see the differences

## Technologies Used

- Node.js
- Express.js
- Puppeteer
- Pixelmatch
- PNG.js
- Diff
- EJS

## License

MIT 
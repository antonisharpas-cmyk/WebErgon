# ErgonSite

Welcome to ErgonSite! Premium websites and digital experiences for ambitious brands.

## Getting Started

Double-click `start.bat`, or run:

```
node server.js
```

Either way the site opens automatically at `http://localhost:3000`
(3001-3003 if that port is busy). Set `PORT` to force a specific one, or
`NO_OPEN=1` to stop it launching a browser.

**Open the site on that port.** VS Code Live Server and other static file
servers will serve the pages but have no `/api/contact`, so the enquiry
form fails with a 405.

Other machines on the same network can reach it at the LAN address the
server prints on startup.

## Contributors

- antonisharpas-cmyk

## License

MIT

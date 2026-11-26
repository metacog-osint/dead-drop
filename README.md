# Dead Drop Toolbox

Standalone analyst tools for open-source work on space, radio, geography and time. Each tool is one page that runs
in the browser: nothing you type is sent anywhere, except where a tool says it looks up public data (a satellite's
orbital elements from CelesTrak, terrain heights, weather) and names the service.

Part of [The Intelligence Company](https://theintelligence.company/)'s suite.

## How a tool is built

| File | What it holds |
|---|---|
| `site/tools/<tool>.html` | the page: inputs, results, and a "How this is worked out" section naming the method and its reference |
| `site/tools/<tool>.js` | the page script |
| `site/lib/<tool>.js` | the maths, as pure functions that load in the browser and in Node |
| `tests/<tool>.test.js` | an offline test that checks the maths against a cited reference or a worked example |

Shared: `site/toolbox.css` and `site/toolbox.js` (the page look and helpers), and the suite's `tic-nav` house bar and
`tic-time` time settings (times show in your own time zone, always named; change it with the **Time** button).

## Run the tests

Node 20 or later, no packages to install:

```
npm test
```

## Run the site locally

Any static file server on `site/`, for example `python -m http.server 8000 --directory site`, then open
http://localhost:8000/.

## Licence

Code: GNU AGPL v3.0 (`LICENSE`). Shared suite scripts and third-party libraries keep their own licences (`NOTICE`).

# Phase 3: External Browser Runtime

## Objective

Replace the Electron `webContents` browser runtime with an external installed Chromium-family browser controlled through Chrome DevTools Protocol.

## Runtime Modes

### Isolated BroCode Browser Profile

This is the default mode. BroCode detects an installed Chrome, Edge, or Chromium executable, launches it with a dedicated BroCode profile, and enables remote debugging on an available loopback port.

The browser launch should include:

```txt
--remote-debugging-port=<free-port>
--user-data-dir=<brocode-browser-profile-dir>
```

Additional flags may be added only when they are needed for reliability and do not create avoidable security risk.

### Existing Debug Browser

This is an advanced mode. The user provides a CDP endpoint such as:

```txt
http://127.0.0.1:9222
```

BroCode validates the endpoint by requesting the browser version and target list before enabling automation.

## Browser Detection

Detection should prefer installed Chromium-family browsers in this order unless platform conventions suggest otherwise:

1. Google Chrome
2. Microsoft Edge
3. Chromium

Detection must be explicit and observable in settings. If no compatible browser is found, the UI should tell the user what to install or how to provide a custom executable path.

## Controller Responsibilities

The browser controller should provide the behavior currently expected by the web app and browser-use pipe:

- open a browser session for a thread
- track tabs and active tab state
- navigate, reload, go back, and go forward
- create, close, and select tabs
- capture screenshots
- copy screenshots to clipboard where supported
- execute CDP commands for browser-use
- stream or poll page title, URL, favicon, loading state, and error state
- clean up launched isolated browser processes when BroCode exits

## Privacy And Safety

The isolated profile is the recommended default because it does not touch the user's everyday browser state.

The existing debug browser mode must display a clear warning before use:

- the connected browser may expose tabs and page contents to automation
- the user is responsible for how the browser was launched
- BroCode will only connect to explicit loopback endpoints by default

BroCode should not silently attach to the normal active browser.

## Acceptance Criteria

- BroCode can launch an installed Chromium-family browser with an isolated profile
- BroCode can connect to a user-provided debug endpoint
- the controller can open, navigate, reload, create tabs, close tabs, select tabs, and capture screenshots
- browser-use requests can execute CDP commands through the external browser
- browser process cleanup is reliable for isolated-profile sessions
- user profile data is stored separately from normal browser data
- failure states are visible and actionable when no browser is found or CDP connection fails

## Test Strategy

- unit tests for browser executable detection and command construction
- integration tests for CDP endpoint validation where environment support exists
- manual smoke tests with Chrome and Edge
- privacy-focused manual checks to confirm isolated profile separation

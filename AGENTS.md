# AGENTS

## After every code change
- Always run the relevant verification before finishing.
- Minimum for UI/frontend changes:
  - `npm run test:ui`
  - `npm run build`
- For Rust / Tauri backend changes also run:
  - `cd src-tauri && cargo test`

## Tests are part of the change
- If behavior changes, update the existing tests to match the new expected behavior.
- If coverage is missing for the thing you changed, add the smallest useful test.
- Do not leave UI state changes untested when they can be covered by `test/hud-logic.test.js` or a nearby test file.

## Failure policy
- Do not claim the task is done if tests/build fail.
- Report which command failed and fix it first when reasonable.

## Bias
- Prefer small, cheap tests around UI state logic over heavy new test frameworks.
- Add broader integration tests only when the simple tests cannot cover the regression.

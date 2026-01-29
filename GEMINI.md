# GEMINI.md

## 1. Automated test loop

Build a way to autonomously test before writing code.
Avoid a manual testing as possible as you can. i.e.

- Don't ask me to reload page by myself and eyecheck the result.
- Don't ask me to check the browser console for errors.
- Don't ask me to check the canvas for correctness.
- Use a systematic method to check the correctness of the code.

## 2. Frontend verification

- Use chrome remote debugger to check verify the frontend code.
- Always find the existing tab and try to reuse it instead of opening a new tab.

## 3. Debugging Checklist

- **Panic in Wasm**:
  - Ensure `console_error_panic_hook` is set up. Check the browser DevTools console for the Rust panic stack trace.

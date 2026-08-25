import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:3000/', { waitUntil:'networkidle' });
await new Promise(r=>setTimeout(r,1000));
// Try to test the approval card directly by injecting a mock
await page.evaluate(() => {
  // Inject a mock approval into the first session if exists, or just test the describeApproval function
  // We'll create a test div to render the approval component manually
  const testData = {
    questions: [
      {
        question: "What should go inside tests.md? And did you mean `tests.md` (with an s)?",
        header: "File content",
        multiSelect: false,
        options: [
          { label: "Empty file", description: "Just create an empty tests.md" },
          { label: "Test plan template", description: "A structured test plan document" },
          { label: "Project test docs", description: "Document the existing tests in this project" }
        ]
      }
    ]
  };
  // Store for later check
  window.__testData = testData;
});
console.log('Mock injected');

// Try to go to the session and check if the approval card would render
await page.goto('http://localhost:3000/session/1133c20a-f491-4485-835b-d6a5e18a1978', { waitUntil:'networkidle' });
await new Promise(r=>setTimeout(r,1500));
const hasSleep = await page.getByText(/Agent sleeping/).first().isVisible().catch(()=>false);
console.log(`Agent sleeping visible: ${hasSleep} (session is idle, so not)`);
await page.screenshot({ path:'/tmp/test_q.png', fullPage:true });
console.log('screenshot /tmp/test_q.png');

// Now test the questionnaire UI by directly evaluating the describeApproval
const result = await page.evaluate(async () => {
  // Dynamically import the approvals module
  try {
    // We can't import TS directly, so we test via the global
    return window.__testData ? 'has test data' : 'no data';
  } catch(e) { return e.message; }
});
console.log(` Eval: ${result}`);

await browser.close();
console.log('done');

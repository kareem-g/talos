/**
 * Status phrase pools for the streaming indicator.
 *
 * Shown *only* while the model is generating. The large GENERAL pool rotates
 * during normal generation; smaller CONTEXT pools are used when the app
 * actually knows the model is doing something specific (only used when that
 * operation is genuinely running — never faked).
 */

export type StreamingStatusMode =
  | 'thinking'
  | 'tool'
  | 'code'
  | 'file'
  | 'image'
  | 'general'

/** Large rotating pool for normal generation. */
export const GENERAL_PHRASES: string[] = [
  'Razzle-dazzling...',
  'Thinking...',
  'Thinking this through...',
  'Analyzing...',
  'Reasoning...',
  'Working through it...',
  'Figuring it out...',
  'Connecting the dots...',
  'Processing...',
  'Considering the possibilities...',
  'Exploring the problem...',
  'Looking into it...',
  'Digging deeper...',
  'Working on it...',
  'Putting it together...',
  'Crafting a response...',
  'Shaping the answer...',
  'Formulating a response...',
  'Organizing my thoughts...',
  'Gathering the details...',
  'Checking the details...',
  'Reviewing the context...',
  'Understanding the request...',
  'Breaking it down...',
  'Going step by step...',
  'Working through the details...',
  'Weighing the options...',
  'Comparing the possibilities...',
  'Finding the best approach...',
  'Looking for the right answer...',
  'Narrowing it down...',
  'Making sense of it...',
  'Connecting everything...',
  'Piecing it together...',
  'Building the answer...',
  'Preparing the response...',
  'Polishing the details...',
  'Refining the answer...',
  'Double-checking...',
  'Cross-checking...',
  'Verifying the details...',
  'Almost there...',
  'Getting there...',
  'Putting the finishing touches on it...',
  'One moment...',
  'Just a moment...',
  'Hang tight...',
  'Working some magic...',
  'Doing the heavy lifting...',
  'Crunching the details...',
  'Untangling the problem...',
  'Following the trail...',
  'Exploring the possibilities...',
  'Searching for the right path...',
  'Finding the signal...',
  'Connecting the pieces...',
  'Turning thoughts into words...',
  'Making the pieces fit...',
  'Putting everything in place...',
  'Working behind the scenes...',
  'Getting things ready...',
  'Bringing it together...',
  'Thinking ahead...',
  'Looking at this from another angle...',
  'Taking a closer look...',
  'Zooming in on the details...',
  'Looking beneath the surface...',
  'Examining the details...',
  'Working out the details...',
  'Finding the missing piece...',
  'Solving the puzzle...',
  'Untangling the details...',
  'Mapping it out...',
  'Building a clearer picture...',
  'Getting the full picture...',
  'Checking my work...',
  'Giving this a second look...',
  'Refining my approach...',
  'Optimizing the answer...',
  'Making this clearer...',
  'Making this useful...',
  'Putting the answer together...',
]

/** Context-specific phrases, keyed by the operation actually happening. */
export const CONTEXT_PHRASES: Record<Exclude<StreamingStatusMode, 'general'>, string[]> = {
  thinking: [
    'Thinking...',
    'Reasoning...',
    'Crafting a response...',
    'Putting it together...',
  ],
  tool: [
    'Running the tool...',
    'Working with the data...',
    'Fetching the information...',
    'Checking the source...',
    'Looking that up...',
  ],
  code: [
    'Writing the code...',
    'Checking the implementation...',
    'Running the code...',
    'Testing the solution...',
    'Looking for issues...',
    'Debugging...',
    'Checking for errors...',
  ],
  file: [
    'Reading the file...',
    'Examining the document...',
    'Looking through the file...',
    'Extracting the relevant details...',
    'Processing the document...',
  ],
  image: [
    'Imagining the scene...',
    'Composing the image...',
    'Working on the details...',
    'Bringing the idea to life...',
  ],
}

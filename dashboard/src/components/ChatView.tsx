/**
 * Desktop chat entry point. The implementation now lives with the shared
 * task components (components/task/TaskView); this alias keeps the existing
 * `ChatView` import path used by SessionDetail intact.
 */
export { TaskView as ChatView } from './task/TaskView'

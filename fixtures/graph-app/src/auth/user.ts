import { validateEmail } from "./validators.js";
export interface User { name: string; email?: string }
export function createUser(name: string): User { return { name, email: validateEmail("guest@example.test") }; }

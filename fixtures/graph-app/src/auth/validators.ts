export function validateEmail(email: string): string { if (!email.includes("@")) throw new Error("Invalid email"); return email; }
export function validatePassword(password: string): boolean { return password.length >= 12; }

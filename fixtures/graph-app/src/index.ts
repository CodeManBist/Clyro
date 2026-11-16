import { createUser } from "./auth/user.js";
import { formatDate } from "./shared/date.js";
import express from "express";

export function start(): string { return `${createUser("guest").name} ${formatDate(new Date())} ${express ? "ready" : ""}`; }

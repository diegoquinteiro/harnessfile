#!/usr/bin/env node
import { createCli } from "../src/cli.js";

const program = createCli();
program.parse();

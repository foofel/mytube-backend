import { sql, SQL } from "bun";
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './drizzle/schema';
import * as relations from './drizzle/relations';

const DB_USER = process.env.DB_USER || "postgres";
const DB_PASSWORD = process.env.DB_PASSWORD || "postgres";
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = process.env.DB_PORT || "5432";
const DB_NAME = process.env.DB_NAME || "postgres";

interface BigInt {
    /** Convert to BigInt to string form in JSON.stringify */
    toJSON: () => string;
}
BigInt.prototype.toJSON = function () {
    return this.toString();
};

const pg = new SQL(`postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);

export const db = drizzle(pg, { schema: { ...schema, ...relations}, logger: true });
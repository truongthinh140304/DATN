import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";

describe("api smoke", () => {
  it("returns health status without database access", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      service: "smart-parking-api",
    });
  });
});

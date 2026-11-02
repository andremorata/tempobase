import { describe, expect, it } from "vitest";
import { ApiError, getApiErrorMessage, parseApiErrorResponse } from "../client";

describe("api client error normalization", () => {
  it("extracts nested reason values from structured errors payloads", async () => {
    const response = new Response(
      JSON.stringify({
        statusCode: 400,
        message: "One or more errors occurred!",
        errors: {
          currentPassword: [
            { reason: "Current password is incorrect." },
          ],
          confirmationText: [
            { message: "Confirmation text must be DELETE WORKSPACE." },
          ],
        },
      }),
      {
        status: 400,
        statusText: "Bad Request",
        headers: { "content-type": "application/json" },
      },
    );

    const error = await parseApiErrorResponse(response);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("Current password is incorrect.");
    expect(error.details).toEqual([
      "Current password is incorrect.",
      "Confirmation text must be DELETE WORKSPACE.",
    ]);
  });

  it("reads the error field that Route Handlers return", async () => {
    const response = new Response(JSON.stringify({ error: "This project is not active." }), {
      status: 409,
      statusText: "Conflict",
      headers: { "content-type": "application/json" },
    });

    const error = await parseApiErrorResponse(response);

    expect(getApiErrorMessage(error, "Fallback message")).toBe("This project is not active.");
  });

  it("getApiErrorMessage prefers extracted detail over the generic message", () => {
    const error = new ApiError(400, "One or more errors occurred!", ["Current password is incorrect."]);

    expect(getApiErrorMessage(error, "Fallback message")).toBe("Current password is incorrect.");
  });
});

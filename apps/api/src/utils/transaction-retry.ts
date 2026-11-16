import { Prisma } from "@prisma/client";
import { AppError } from "./http.js";

export async function retryTransaction<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable) throw error;
      if (attempt === 2)
        throw new AppError(
          409,
          "Concurrent gate update; retry the scan request",
        );
    }
  }
  throw new AppError(409, "Concurrent gate update");
}

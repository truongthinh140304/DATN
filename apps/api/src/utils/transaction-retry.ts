import { Prisma } from "@prisma/client";
import { AppError } from "./http.js";

export async function retryVisionTransaction<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" ||
          (error.code === "P2002" &&
            (JSON.stringify(error.meta?.target) || "").includes("active_key")));
      if (!retryable) throw error;
      if (attempt === 2)
        throw new AppError(
          409,
          "Concurrent camera update; retry the observation batch",
        );
    }
  }
  throw new AppError(409, "Concurrent camera update");
}

import { z } from "zod";

export const uuidParam = z.object({ id: z.string().uuid() });
export const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  q: z.string().trim().optional(),
});

export const vehicleBody = z.object({
  plateNumber: z
    .string()
    .trim()
    .min(4)
    .max(20)
    .transform((value) => value.toUpperCase()),
  type: z.enum(["MOTORBIKE", "CAR", "OTHER"]),
  brand: z.string().trim().max(80).optional(),
  color: z.string().trim().max(40).optional(),
});

export const lotBody = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(3).max(255),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
});

export const areaBody = z.object({
  lotId: z.string().uuid(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  floor: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const spotBody = z.object({
  areaId: z.string().uuid(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((value) => value.toUpperCase()),
  status: z.enum(["AVAILABLE", "RESERVED", "OCCUPIED", "INACTIVE"]).optional(),
  isActive: z.boolean().optional(),
});

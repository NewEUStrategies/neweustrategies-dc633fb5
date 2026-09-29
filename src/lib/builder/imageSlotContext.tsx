import { createContext, useContext } from "react";
import type { ImageSlot } from "./imageSlot";

export const BuilderImageSlotContext = createContext<ImageSlot | undefined>(undefined);
export const useBuilderImageSlot = () => useContext(BuilderImageSlotContext);

// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { pixels } from "./pixels";

export function appIcon() {
  return pixels(30, 30, (R, E, P, T) => {
    R(0, 0, 30, 30, "#1d2044");
    E(15, 19, 12, 10, "#3b78d8");
    E(10, 17, 5, 4, "#5fbf4a");
    E(21, 21, 4, 3, "#5fbf4a");
    T(7, 2, 3, 7, "#f2c94c");
    T(15, 0, 3, 9, "#f2c94c");
    T(23, 2, 3, 7, "#f2c94c");
    R(6, 8, 18, 2, "#f2c94c");
    R(8, 15, 14, 2, "#e0b184");
    R(10, 17, 2, 9, "#f4f0e8");
    R(18, 17, 2, 9, "#f4f0e8");
    R(8, 26, 14, 2, "#c9ccd6");
    R(13, 19, 4, 9, "#2b2233");
    R(14, 21, 2, 2, "#f2c94c");
  });
}

import { useRef } from "react";
import { GlobeMap, type MapHandle } from "../globe/Map";

// Keep Rybbit's login globe panel. Its public, decorative map uses the same
// approved India POV boundaries as every other MetriBee map, without exposing
// authenticated visitor locations or depending on Rybbit's demo service.
export function SpinningGlobe() {
  const handle = useRef<MapHandle | null>(null);
  return (
    <GlobeMap
      cities={[]}
      flat={false}
      style="dark"
      night={false}
      spin
      privacy={false}
      faces={false}
      onSelect={() => {}}
      handle={handle}
      onEngine={() => {}}
      lightweight
    />
  );
}

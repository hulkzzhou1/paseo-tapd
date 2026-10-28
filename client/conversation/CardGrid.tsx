import { Children, useState, type ReactNode } from "react";
import { View } from "react-native";

/** Measure the panel, since it can be narrower than the browser viewport. */
export function CardGrid({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(0);
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
    {Children.map(children, child => child ? <View style={{ width: width >= 520 ? (width - 8) / 2 : "100%", minWidth: 0 }}>{child}</View> : null)}
  </View>;
}

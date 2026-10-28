import {useCallback,useEffect,useRef,useState} from "react";
import {Platform} from "react-native";

type ObservedNode={ownerDocument?:{visibilityState:string;addEventListener:(name:string,listener:()=>void)=>void;removeEventListener:(name:string,listener:()=>void)=>void}};
type Observer={observe:(node:ObservedNode)=>void;disconnect:()=>void};
type ObserverConstructor=new (callback:(entries:{isIntersecting:boolean}[])=>void)=>Observer;
/** The SDK has no active-tab flag; a browser intersection observes hidden mounted panels. */
export function usePanelVisibility(){
 const [visible,setVisible]=useState(false);const cleanup=useRef<()=>void>(()=>{});
 const ref=useCallback((node:unknown)=>{
  cleanup.current();setVisible(false);
  if(!node||Platform.OS!=="web")return;
  const Observer=(globalThis as unknown as {IntersectionObserver?:ObserverConstructor}).IntersectionObserver;
  if(!Observer)return;
  const element=node as ObservedNode,document=element.ownerDocument;let intersecting=false;
  const update=()=>setVisible(intersecting&&document?.visibilityState!=="hidden");
  const observer=new Observer(entries=>{intersecting=entries.some(entry=>entry.isIntersecting);update();});observer.observe(element);
  document?.addEventListener("visibilitychange",update);
  cleanup.current=()=>{observer.disconnect();document?.removeEventListener("visibilitychange",update);};
 },[]);
 useEffect(()=>()=>cleanup.current(),[]);
 return {ref,visible};
}

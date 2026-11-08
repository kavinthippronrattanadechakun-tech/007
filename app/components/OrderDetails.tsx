"use client";
import CopyDelivery from "./CopyDelivery";
import { orderCopyText, type OrderTiming } from "../../lib/order-expiry";
export default function OrderDetails({ order }: { order: OrderTiming }) {
  return <CopyDelivery text={orderCopyText(order)} />;
}

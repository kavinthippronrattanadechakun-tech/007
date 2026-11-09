"use client";
import CopyDelivery from "./CopyDelivery";
import { orderCopyText, type OrderTiming } from "../../lib/order-expiry";
export default function OrderDetails({
  order,
  productTitle,
}: {
  order: OrderTiming;
  productTitle: string;
}) {
  return <CopyDelivery text={orderCopyText(order, productTitle)} />;
}

import { send } from "@vercel/queue";
import { NextResponse } from 'next/server';


export async function POST(req: NextResponse) {
    const body = await req.json(); // parses JSON body
    console.log("body", body);
   
    await send("topic", { message: "Hello World!" });


    return new Response("OK", { status: 200 });
}

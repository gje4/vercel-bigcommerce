import { send, receive } from "@vercel/queue";
import { NextResponse } from 'next/server';


export async function POST(request: Request): Promise<NextResponse> {
    const body = await request.json(); // parses JSON body
    console.log("body", body);
    // 
    await send("topic", { message: "Hello World!" });


    return NextResponse.json({ message: "OK" }, { status: 200 });

}


await receive("topic", "consumer", (m: any) => {

    console.log(m.message); // Logs "Hello World!"
  });
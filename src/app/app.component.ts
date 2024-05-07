import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RouterOutlet } from '@angular/router';

type Iframe = {
  url: string
  safeUrl: SafeResourceUrl
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  @ViewChild('urlInput') urlInputRef?: ElementRef<HTMLInputElement>;

  ws?: WebSocket;
  gp?: Gamepad | null;

  statusText?: string;
  messages: string[] = [];

  previousPacket?: [number, number];
  prevString?: string;

  iframes: Iframe[] = [];

  sentMacros: boolean[] = [];
  macroMap = [
    5, // Dump cycle
    6, // Dig cycle
  ];

  constructor(public sanitizer: DomSanitizer) {}

  // ngOnInit() {
  //   this.urlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(this.url);
  // }

  ngOnInit() {
    window.addEventListener('gamepadconnected', (e) => {
      const gamepads = navigator.getGamepads();
      if (gamepads.length > 0) {
        this.gp = gamepads[0];
      }
      console.log(
        'Gamepad connected at index %d: %s. %d buttons, %d axes.',
        e.gamepad.index,
        e.gamepad.id,
        e.gamepad.buttons.length,
        e.gamepad.axes.length
      );
    });

    const timeout = setInterval(() => {
      const gamepads = navigator.getGamepads();
      if (gamepads.length > 0) {
        this.gp = gamepads[0];
        if (this.gp) {
          const left = this.gp.axes[1];
          const right = this.gp.axes[3];
          const t = [...this.gp.buttons.slice(4, 8).map((b) => b.pressed)];
          this.sendMotionPacket(left, right, [t[0], t[1], t[2], t[3]]);
          this.sendMacroPacket(this.gp.buttons);
          // sendJoystickData(gp.axes[1], gp.axes[3]);
        }
      }
    }, 50);

    window.addEventListener('gamepaddisconnected', (e) => {
      const gamepads = navigator.getGamepads();
      if (gamepads.length <= 0) {
        this.gp = null;
        clearInterval(timeout);
        this.sendMotionPacket(0, 0, [false, false, false, false]);
      }
    });
  }

  // Creates web socket connection with the device with the specified url
  async connect(): Promise<void> {
    const url = this.urlInputRef?.nativeElement.value;

    if (!url) {
      alert('Please enter a url');
      return;
    }

    this.statusText = `Connecting to ${url}`;
    try {
      // Set ws = to a new WebSocket instance if succesfully created
      this.ws = await new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const timer = setInterval(() => {
          if (ws.readyState === 1) {
            clearInterval(timer);
            resolve(ws);
          }
        }, 10);
      });

      this.statusText = `Successfully connected to ${url}`;

      // Set the incoming message handler of the new WebSocket instance
      this.ws.onmessage = (e) => {
        this.messages.push(e.data.toString());
      };

      // Set the connection close handler of the new WebSocket instance
      this.ws.onclose = (e) => {
        this.statusText = `Closed connection with ${url} because ${e.reason}`;
      };

      // Set the error handler of the new WebSocket instance
      this.ws.onerror = (e) => {
        this.statusText = `Error with ${url}`;
      };
    } catch (e) {
      // WebSocket was not successfully made
      this.statusText = String(e);
    }
  }

  async disconnect(): Promise<void> {
    this.statusText = 'disconnecting with ' + this.ws?.url;
    this.ws?.close();
  }

  // Sends a formatted packet to the server with the data in the parameters
  async sendMotionPacket(
    leftWheel: number,
    rightWheel: number,
    triggers: [boolean, boolean, boolean, boolean]
  ): Promise<void> {
    // if (leftWheel < -1 || leftWheel > 1 || rightWheel < -1 || rightWheel > 1 || !ws) return;

    // Declare bytes array with length 2
    let bytes: [number, number] = [0, 0];

    // Add trigger data to bits 1...4 of byte 0
    let temp = 0b0100_0000;
    for (let i = 0; i < 4; i++) {
      if (triggers[i]) {
        bytes[0] |= temp;
      }
      temp >>= 1;
    }

    let leftMagnitude = Math.round(Math.abs(leftWheel) * 7);
    let rightMagnitude = Math.round(Math.abs(rightWheel) * 7);
    let isLeftNegative = leftWheel > 0; // Set it to be opposite of what is being read
    let isRightNegative = rightWheel > 0; // Sama as above

    // If left wheel is negative set the left sign bit to 1
    if (isLeftNegative) bytes[1] |= 0b1000_0000;
    // If right wheel is negative set the right sign bit to 1
    if (isRightNegative) bytes[1] |= 0b0000_1000;

    // Add left wheel magnitude data to bits 1...3 in byte 1
    bytes[1] |= (leftMagnitude << 4) & 0b0111_0000;

    // Add right wheel magnitude data to bits 5...7 in byte 1
    bytes[1] |= rightMagnitude & 0b0000_0111;

    // If packet is identical to previously sent packet return
    // if (bytes[0] == previousPacket[0] && bytes[1] == previousPacket[1]) return;
    this.previousPacket = bytes;

    this.ws?.send(new Int8Array(bytes));
    this.prevString = '';
    for (const char of String.fromCharCode(...bytes)) {
      this.prevString += char.charCodeAt(0).toString(2).padStart(8, '0') + ' ';
    }
  }

  async sendMacroPacket(buttons: readonly GamepadButton[]): Promise<void> {
    let macroCode = -1;
    for (let i = buttons.length - 1; i >= 0; i--) {
      if (!buttons[i].pressed) {
        this.sentMacros[i] = false;
        continue;
      }

      if (
        (this.sentMacros.length > i && this.sentMacros[i]) ||
        this.macroMap.length <= i
      )
        continue;

      macroCode = this.macroMap[i];
      this.sentMacros[i] = true;
    }

    if (macroCode < 0) return;

    let byte = 0b1000_0010;
    byte |= (macroCode << 2) & 0b0111_1100;

    this.ws?.send(new Int8Array([byte]));
  }

  addIFrame(): void {
    const defaultUrl = `http://10.49.28.131:8889/mystream${this.iframes.length || ''}`;
    this.iframes.push({
      url: defaultUrl, 
      safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(defaultUrl)
    });
  }

  editIFrame(event: KeyboardEvent, index: number): void {
    let value = (event.target as HTMLInputElement).value;
    this.iframes[index] = {
      url: value, 
      safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(value)
    }
  }

  removeIFrame(index: number): void {
    this.iframes.splice(index, 1);
  }
}

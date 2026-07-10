import { error } from "console";

export class PulseAgent{
    private ingestUrl: string;
    private serviceName: string;

    constructor(serviceName:string, ingestUrl: string = 'http://localhost:3000/api/logs'){
        this.ingestUrl=ingestUrl;
        this.serviceName=serviceName;
    }

    // Method
    // start the agent and override default console behaviours
    public start(){
        console.log(`[Pulse-APM] Agent started for service: ${this.serviceName}`);

        // 1. Intercept standard console error
        const originalConsoleError = console.error;
        console.error = (...args: any[]) => {
            const errorMessage = args.map(arg=> typeof arg === 'object'? JSON.stringify(arg) : arg).join(' ');

            // send to pulse apm directly
            this.sendError(errorMessage);

            originalConsoleError.apply(console, args);
        };

        // 2. Intercept massive appllication crashes (The Airbag)
        process.on('uncaughtException', (error:Error) => {
            this.sendError(`FATAL CRASH: ${error.message}`);
            originalConsoleError('FATAL CRASH INTERCEPTED BY Pulse-APM:', error);
        });

    }

    // Function that ships the error back to the backend
    private async sendError(errorMessage: String){
        try {
            await fetch(this.ingestUrl, {
                method:'POST', // specifying the method
                headers: {'Content-Type': 'application/json'}, // telling the server we are sending JSON
                body: JSON.stringify({
                    error:errorMessage,
                    service:this.serviceName
                })
            });
        } catch (error) {
            
        }
    }
}
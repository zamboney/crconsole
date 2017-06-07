#Save Chromecast receiver Logs procedure
##Perquisites:
npm is installed on your machine (https://www.npmjs.com/get-npm)
Chromecast
###Step 1:
Get Chromecast device IP.
1. Make sure chromecast and your computer are connected to the same network.
2. Navigate to: chrome://cast/#devices
3. Open your Chromecast device settings
4. Copy your Chromecast device IP <Chromecast_IP>
###Step 2:
Install crconsole tool
Open command line interface (Terminal, cmd, etc.)
1. Type : npm install –g https://github.com/zamboney/crconsole.git
###Step 3:
Run console tool
1. In terminal, type: crconsole –host <Chromecast_IP> --outputfile <pathToFile/Name>
This will show you the chromecast receiver logs and write them to the file you asked.
Note: in case you get an error, go to activity monitor and kill node.js process.
###Step 4:
Show Chromecast logs on browser
1. Open the browser and type localhost:3000
###Step 5:
Open saved logs.
1. Once you’re done, go to the file and open it from <pathToFile>